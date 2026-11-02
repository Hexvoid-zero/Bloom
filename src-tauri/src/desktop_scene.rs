//! In-memory scene behind Bloom: wallpaper plus intersecting windows in Z order.
//! Bloom's own surfaces are excluded, avoiding recursive captures of the dock.
use base64::Engine;
use std::{sync::{Mutex,OnceLock},time::Instant};
use windows::{core::w,Win32::{Foundation::*,Graphics::Gdi::*,System::Registry::*,UI::WindowsAndMessaging::*}};
struct Wallpaper { checked:Instant, image:Option<image::RgbaImage>, style:String, tile:bool }
static WALLPAPER:OnceLock<Mutex<Option<Wallpaper>>>=OnceLock::new();
unsafe fn registry_string(value:windows::core::PCWSTR)->String {
 let mut data=[0u16;512];let mut bytes=std::mem::size_of_val(&data) as u32;
 if RegGetValueW(HKEY_CURRENT_USER,w!("Control Panel\\Desktop"),value,RRF_RT_REG_SZ,None,Some(data.as_mut_ptr().cast()),Some(&mut bytes)).0!=0{return String::new();}
 String::from_utf16_lossy(&data[..data.iter().position(|c|*c==0).unwrap_or(data.len())])
}
fn wallpaper_pixel(x:f64,y:f64,sw:f64,sh:f64,iw:u32,ih:u32,style:&str,tile:bool)->Option<(u32,u32)> {
 if sw<=0.||sh<=0.||iw==0||ih==0{return None;}
 if tile{return Some((x.rem_euclid(iw as f64) as u32,y.rem_euclid(ih as f64) as u32));}
 let (sx,sy)=if style=="2"{(sw/iw as f64,sh/ih as f64)}else{let z=if style=="6"{(sw/iw as f64).min(sh/ih as f64)}else if style=="0"{1.}else{(sw/iw as f64).max(sh/ih as f64)};(z,z)};
 let px=(x-(sw-iw as f64*sx)*0.5)/sx;let py=(y-(sh-ih as f64*sy)*0.5)/sy;
 if px<0.||py<0.||px>=iw as f64||py>=ih as f64{None}else{Some((px as u32,py as u32))}
}
fn load_wallpaper(path:&str)->Option<image::RgbaImage>{
 image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.decode().ok().map(|i|i.into_rgba8())
}
unsafe fn wallpaper(region:RECT)->image::RgbaImage {
 let width=(region.right-region.left) as u32;let height=(region.bottom-region.top) as u32;
 let background=GetSysColor(COLOR_DESKTOP);
 let mut output=image::RgbaImage::from_pixel(width,height,image::Rgba([(background&255) as u8,((background>>8)&255) as u8,((background>>16)&255) as u8,255]));
 let Ok(mut cache)=WALLPAPER.get_or_init(Default::default).lock() else{return output};
 if cache.as_ref().is_none_or(|w|w.checked.elapsed().as_secs()>=5){
  let mut path=[0u16;1024];
  let image=if SystemParametersInfoW(SPI_GETDESKWALLPAPER,path.len() as u32,Some(path.as_mut_ptr().cast()),SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).is_ok(){let path=String::from_utf16_lossy(&path[..path.iter().position(|c|*c==0).unwrap_or(path.len())]);load_wallpaper(&path)}else{None};
  *cache=Some(Wallpaper{checked:Instant::now(),image,style:registry_string(w!("WallpaperStyle")),tile:registry_string(w!("TileWallpaper"))=="1"});
 }
 let Some(wall)=cache.as_ref() else{return output};let Some(img)=wall.image.as_ref() else{return output};
 let mut info=MONITORINFO{cbSize:std::mem::size_of::<MONITORINFO>() as u32,..Default::default()};
 let monitor=MonitorFromPoint(POINT{x:region.left+width as i32/2,y:region.top+height as i32/2},MONITOR_DEFAULTTONEAREST);
 if !GetMonitorInfoW(monitor,&mut info).as_bool(){return output;}
 let bounds=if wall.style=="22"{RECT{left:GetSystemMetrics(SM_XVIRTUALSCREEN),top:GetSystemMetrics(SM_YVIRTUALSCREEN),right:GetSystemMetrics(SM_XVIRTUALSCREEN)+GetSystemMetrics(SM_CXVIRTUALSCREEN),bottom:GetSystemMetrics(SM_YVIRTUALSCREEN)+GetSystemMetrics(SM_CYVIRTUALSCREEN)}}else{info.rcMonitor};
 for y in 0..height {for x in 0..width {if let Some((px,py))=wallpaper_pixel((region.left-bounds.left) as f64+x as f64,(region.top-bounds.top) as f64+y as f64,(bounds.right-bounds.left) as f64,(bounds.bottom-bounds.top) as f64,img.width(),img.height(),&wall.style,wall.tile){output.put_pixel(x,y,*img.get_pixel(px,py));}}}
 output
}
/// Called on the bounded single capture worker, never on the UI thread.
pub unsafe fn capture(region:RECT,owner:HWND)->Option<(String,usize)> {
 let mut layers=Vec::new();let mut cursor=GetWindow(owner,GW_HWNDNEXT).ok();
 for _ in 0..256 {
  let Some(hwnd)=cursor else{break};cursor=GetWindow(hwnd,GW_HWNDNEXT).ok();
  let mut pid=0;GetWindowThreadProcessId(hwnd,Some(&mut pid));
  if pid==std::process::id()||!IsWindowVisible(hwnd).as_bool()||IsIconic(hwnd).as_bool(){continue;}
  let mut class=[0u16;128];let n=GetClassNameW(hwnd,&mut class);let class=String::from_utf16_lossy(&class[..n.max(0) as usize]);
  if matches!(class.as_str(),"Progman"|"WorkerW"|"Shell_TrayWnd"|"Shell_SecondaryTrayWnd"){continue;}
  let mut cloaked=0u32;
  if windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(hwnd,windows::Win32::Graphics::Dwm::DWMWA_CLOAKED,(&mut cloaked as *mut u32).cast(),std::mem::size_of::<u32>() as u32).is_ok()&&cloaked!=0{continue;}
  let mut rect=RECT::default();if GetWindowRect(hwnd,&mut rect).is_err(){continue;}
  let clip=RECT{left:region.left.max(rect.left),top:region.top.max(rect.top),right:region.right.min(rect.right),bottom:region.bottom.min(rect.bottom)};
  if clip.right<=clip.left||clip.bottom<=clip.top{continue;}
  layers.push((hwnd,rect,clip));
  if layers.len()>=8||(clip.left==region.left&&clip.top==region.top&&clip.right==region.right&&clip.bottom==region.bottom){break;}
 }
 let mut result=wallpaper(region);let count=layers.len();
 for (hwnd,rect,clip) in layers.into_iter().rev(){
  let crop=RECT{left:clip.left-rect.left,top:clip.top-rect.top,right:clip.right-rect.left,bottom:clip.bottom-rect.top};
  // A failed/protected capture leaves the real compositor visible, never a fake black plate.
  let data=crate::utils::capture_hwnd_region_to_base64(hwnd,crop)?;
  let bytes=base64::engine::general_purpose::STANDARD.decode(data.split_once(',')?.1).ok()?;
  let img=image::load_from_memory(&bytes).ok()?.into_rgba8();
  image::imageops::overlay(&mut result,&img,(clip.left-region.left) as i64,(clip.top-region.top) as i64);
 }
 let mut png=std::io::Cursor::new(Vec::new());result.write_to(&mut png,image::ImageFormat::Png).ok()?;
 Some((format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png.into_inner())),count))
}
#[cfg(test)]mod tests{
 use super::wallpaper_pixel;
 #[test]fn extensionless_windows_wallpaper_is_decoded(){
  let path=std::env::temp_dir().join(format!("bloom-wallpaper-test-{}",std::process::id()));
  let image=image::RgbaImage::from_pixel(2,2,image::Rgba([22,88,166,255]));let mut bytes=std::io::Cursor::new(Vec::new());image.write_to(&mut bytes,image::ImageFormat::Png).unwrap();std::fs::write(&path,bytes.into_inner()).unwrap();
  let loaded=super::load_wallpaper(path.to_str().unwrap());let _=std::fs::remove_file(path);assert_eq!(loaded.unwrap().get_pixel(0,0).0,[22,88,166,255]);
 }
 #[test]fn fill_crops_symmetrically(){assert_eq!(wallpaper_pixel(0.,0.,100.,100.,200,100,"10",false),Some((50,0)));}
 #[test]fn fit_leaves_letterbox(){assert_eq!(wallpaper_pixel(0.,0.,100.,100.,200,100,"6",false),None);assert_eq!(wallpaper_pixel(50.,50.,100.,100.,200,100,"6",false),Some((100,50)));}
 #[test]fn stretch_and_tiles_map_correctly(){assert_eq!(wallpaper_pixel(50.,50.,100.,100.,200,100,"2",false),Some((100,50)));assert_eq!(wallpaper_pixel(250.,20.,100.,100.,200,100,"0",true),Some((50,20)));}
 #[test]fn invalid_wallpaper_never_indexes_pixels(){assert_eq!(wallpaper_pixel(1.,1.,0.,100.,0,0,"10",false),None);}
}

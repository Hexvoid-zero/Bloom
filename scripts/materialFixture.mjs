export function setup(label){
 const icon=(name,c)=>'data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="12" fill="${c}"/><text x="24" y="32" fill="white" font-family="Arial" font-size="25" text-anchor="middle">${name[0]}</text></svg>`);
 const names=['Chrome','Microsoft Word','Visual Studio Code','Claude','Codex','Cursor','Settings','Photos','Notepad','Calculator','Spotify','Phone Link','File Explorer','Outlook','Terminal','Paint','Firefox','Gemini CLI','OneNote','PowerPoint'];
 const apps=names.map((name,i)=>({name,path:`app-${i}`,icon:icon(name,['#537abc','#b7638a','#6c59b1','#bb7958','#548f86'][i%5])}));
 const sessions=[{id:'a',agent:'Codex',project:'Bloom',status:'working',detail:'Running a tool',updated_at:Date.now()/1000,path:'C:\\Projects\\Bloom'},{id:'b',agent:'Claude Code',project:'Website',status:'needs-attention',detail:'Permission request',updated_at:Date.now()/1000,path:'C:\\Projects\\Website'},{id:'c',agent:'Cursor',project:'Mobile app',status:'completed',detail:'Turn completed',updated_at:Date.now()/1000,path:'C:\\Projects\\Mobile'},{id:'d',agent:'Antigravity',project:'Antigravity',status:'app-open',source:'process',detail:'App running; activity unavailable',updated_at:Date.now()/1000,path:''}];
 const settings={'bloom-liquid-glass-dock':'true','bloom-liquid-glass-notch':'true','bloom-liquid-glass-start':'true','bloom-notch-mode':'overlay','bloom-scale':'1','bloom-dock-enabled':'false','bloom-first-run':'done','bloom-app-version':'3.10.0','bloom-weather-enabled':'false','bloom-corners-enabled':'false','bloom-start-preferences':localStorage.getItem('bloom-start-preferences')||''};
 Object.entries(settings).forEach(([k,v])=>localStorage.setItem(k,v));localStorage.setItem('bloom-announcement-cache-at',String(Date.now()));
 let id=0;const callbacks=new Map(),listeners=new Map();
 window.__fixture={calls:[],settings,sessions,emit(event,payload){for(const [key,l]of listeners)if(l.event===event)callbacks.get(l.handler)?.({event,payload,id:key});}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label},currentWebview:{label}},transformCallback(cb){callbacks.set(++id,cb);return id;},unregisterCallback(k){callbacks.delete(k);},async invoke(cmd,args={}){
  window.__fixture.calls.push({cmd,args});
  if(cmd==='load_settings')return settings;
  if(['get_active_windows','get_tray_apps','get_dock_extras'].includes(cmd))return [];
  if(cmd==='get_custom_icons')return {};
  if(cmd==='get_app_icon')return apps.find(a=>a.path===args.path)?.icon||null;
  if(cmd==='save_setting'){settings[args.key]=args.value;localStorage.setItem(args.key,args.value);window.__fixture.emit('settings-changed',{key:args.key,value:args.value});return;}
  if(cmd==='plugin:event|listen'){listeners.set(++id,args);return id;}
  if(cmd==='plugin:event|unlisten')return listeners.delete(args.eventId);
  if(cmd==='get_installed_apps')return window.__fixture.catalogPending?[]:apps;
  if(cmd==='load_pinned_apps')return apps.slice(0,16);
  if(cmd==='get_agent_sessions')return window.__fixture.sessions;
  if(cmd==='get_wifi_status')return {enabled:window.__fixture.wifiEnabled??true,connected:window.__fixture.wifiEnabled!==false,ssid:'Fixture Home'};
  if(cmd==='wifi_list_networks')return {location_denied:false,networks:[{ssid:'Fixture Home',signal:92,security:'wpa2',connected:true,saved:true},{ssid:'Fixture Guest',signal:70,security:'wpa2',connected:false,saved:false}]};
  if(cmd==='set_wifi_state'){if(window.__fixture.failWifiToggle)throw Error('Controlled radio failure');window.__fixture.wifiEnabled=args.enabled;return;}
  if(cmd==='wifi_scan'){window.__fixture.emit('wifi-changed',null);return;}
  if(cmd==='wifi_connect'||cmd==='wifi_disconnect'||cmd==='wifi_forget'){window.__fixture.emit('wifi-changed',null);return;}
  if(cmd==='get_agent_hook_integrations')return [];
  if(cmd==='get_start_context')return {username:'Workspace owner'};
  if(cmd==='get_phone_link_status')return {installed:true,status:'available',phones:[{name:'Redmi Note 13 5G',connected:true,battery:null}],detail:'Bluetooth connected. Open Phone Link for messages, calls and notifications.'};
  if(cmd==='get_audio_sessions')return [{pid:1,name:'Music',volume:.5,is_muted:false}];
  if(cmd==='plugin:window|is_visible')return true;
  if(cmd==='plugin:app|version')return '3.10.0';
  if(cmd==='plugin:app|identifier')return 'com.sehaz.bloom.macdock';
  if(cmd==='get_volume_state')return {volume:.5,is_muted:false};
  if(cmd==='get_brightness')return 60;
  if(cmd==='get_network_speed')return [0,0];
  if(cmd==='get_cpu_usage'||cmd==='get_ram_usage'||cmd==='get_disk_space')return 20;
  if(cmd==='load_shelf_items'||cmd==='get_bluetooth_devices'||cmd==='get_connected_bluetooth_devices'||cmd==='plugin:window|get_all_windows')return [];
  return null;
 }};
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
}

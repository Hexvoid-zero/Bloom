import { Volume2, Sun } from "lucide-react";
import { SettingRow } from "./SettingRow";

interface OverlaysTabProps {
	volumeOverlayEnabled: boolean;
	toggleVolumeOverlay: () => void;
	volumeEdgeEnabled: boolean;
	toggleVolumeEdge: () => void;
	brightnessOverlayEnabled: boolean;
	toggleBrightnessOverlay: () => void;
	brightnessEdgeEnabled: boolean;
	toggleBrightnessEdge: () => void;
}

export function OverlaysTab({
	volumeOverlayEnabled,
	toggleVolumeOverlay,
	brightnessOverlayEnabled,
	toggleBrightnessOverlay
}: OverlaysTabProps) {
	return (
		<>
			<div className="setting-group-label">Notch controls</div>
			<div className="setting-group">
				<SettingRow icon={Volume2} label="Volume HUD" desc="Show volume changes inside the top notch">
					<label className="toggle-switch">
						<input type="checkbox" checked={volumeOverlayEnabled} onChange={toggleVolumeOverlay} />
						<span className="slider"></span>
					</label>
				</SettingRow>


				<SettingRow icon={Sun} label="Brightness HUD" desc="Show brightness changes inside the top notch">
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={brightnessOverlayEnabled}
							onChange={toggleBrightnessOverlay}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

			</div>
		</>
	);
}

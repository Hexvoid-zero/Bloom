# Liquid Glass research and Windows rendering

Reviewed all five Apple references on October 30, 2026:

- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views): a responsive material with background blur and reflected light/color; shape, tint and interaction are separate choices. It recommends sharing rendering work in a container and limiting concurrent effects.
- [Landmarks](https://developer.apple.com/documentation/swiftui/landmarks-building-an-app-with-liquid-glass): backgrounds extend underneath navigation controls, related toolbar controls form groups, and content stays separate from its material. Its badges demonstrate identity-based transitions.
- [glassEffect](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)): the effect belongs behind the padded view bounds. The default shape is a capsule; content and material are distinct layers.
- [glassEffectTransition](https://developer.apple.com/documentation/swiftui/view/glasseffecttransition(_:)): transitions coordinate effects when views enter or leave a container. A CSS opacity change alone does not reproduce that behavior.
- [GlassEffectContainer](https://developer.apple.com/documentation/swiftui/glasseffectcontainer): shared shape rendering improves performance and supports geometry blending as shapes approach each other.

## Implementation

The dock uses one WebGL2 surface behind its icons, rather than one effect per icon. A rounded signed-distance boundary supplies lens normals. A shader combines transmitted background color, diffusion, chromatic separation at the boundary, surrounding reflection and pointer/press highlights. The DOM remains responsible for crisp icons, labels and hit targets. The shader measures the live dock bounds while its existing layout changes, so the lens follows the same surface.

A bounded native worker composites a narrow strip of wallpaper and intersecting application windows in back-to-front order. Bloom's own windows are excluded, preventing recursive dock images. It accounts for wallpaper fill, fit, center, stretch, span and tiling. Captures remain in memory. At most one worker runs; nonresponsive or protected surfaces fall back to the real transparent compositor with CSS highlights. GPU failure also retains a clear CSS fallback. No opaque full-width background is added. Capture work stops when the saved Liquid Glass switch is off. The normal dock remains a separate appearance.

This is a custom Windows renderer, not Apple's proprietary SwiftUI renderer or an exact implementation of its undisclosed optical algorithms. The five documents describe API behavior and composition; they do not publish Apple's shader source. The dock is one connected shape, so separate-shape union/morph APIs have no direct counterpart to invoke here. Dynamic or protected applications may not expose capturable pixels. Windows desktop icons and nonstandard compositing surfaces may differ from the sampled scene.

## MacOS Start reference

The user screenshot is authoritative. An image-to-code reference was generated before implementation to inspect the same menu at readable scale. The coded panel preserves its 426 × 534 size, 60-pixel sidebar, 36-pixel rows, 28-pixel icons, compact centered titlebar, warm frosted material and inset list. Installed app names/icons replace reference-only example applications. Each sidebar control performs an actual action. Existing Bloom Start customization is retained under its original menu style.

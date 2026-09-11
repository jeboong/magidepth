# MagiMagic · 매지매직

MagiMagic is the application. MagiDepth is the depth-map workspace and MagiCloak is the face-grid workspace. The mascot, 매지코, speaks in an eccentric, mischievous and playful voice. Friendly hints may be strange; errors, destructive actions, installation and saving must remain precise and understandable. The main tagline is “매지코의 마법을 느껴보세요”. Legacy asset filenames, app ID, repository and cache directories remain stable for update compatibility.

The name and character artwork were selected by the project owner. The character asset is for application branding and is excluded from the source-code MIT grant. The authorized branding PNG and derived onboarding poses are published; private source filenames, personal paths, and the original MOV are not.

From v0.3, `public/brand/magidepth.png` is the exact latest owner-supplied transparent PNG: the left face is monochrome depth-style and the right colored face carries a bold white ellipse grid. No generative edit, flip, recolor or cutout was applied. Source SHA-256: `b49f6afeea56da2087254897d4671755bc6d4bf1c917aa5578a3ce4cd14a602c`. The legacy filename remains for asset compatibility. Windows ICO variants are deterministic format conversions produced by `npm run build:icon`.

The header uses the static face as an accessible two-part selector. The visible left half opens MagiDepth and the visible right half opens MagiCloak; hover and selected overlays are UI layers, never baked into the original asset.

From v0.3.2, onboarding alone uses the owner's alpha MOV as a cursor-driven pose bank under `public/brand/onboarding-mascot/`. It contains 50 sampled alpha poses and a flow-aligned seam bank, not the private source movie. Source SHA-256: `ec12991cf7f834a181ccc056c1d8329e422ec0ff20853abf1657eee6be40a712`. The static header/ICO artwork remains unchanged. A fixed crop preserves the supplied matte; the source contains transparent holes in some dark interior details, which remain visible on light backgrounds.

Rebuild locally with `node scripts/prepare-mascot.mjs <source-alpha.mov>`, then run `scripts/prepare-mascot-seam.py --publish` using Python with OpenCV and NumPy. Runtime users do not need these preprocessing tools. The intermediate seam frames use bidirectional DIS optical flow in premultiplied RGBA to avoid a double-face crossfade. The seam midpoint is also the idle pose and poster, so returning to rest does not jump back to a mismatched source endpoint.

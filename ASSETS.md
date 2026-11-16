# Assets and third-party licenses

The root `LICENSE` and `NOTICE` apply to MDRK Studio's original source code. Third-party assets and dependencies retain their own licenses.

## Industrial geometry

`public/models/industrial/refinery-parts.glb` derives from **Refinery Parts** by **Phil R.**, under the 3D Warehouse General Model License Agreement. See its [attribution and original source](public/models/industrial/ATTRIBUTION.md). It is integrated into this complete application and is not offered as a standalone model pack.

## HDR environment

`public/hdri/kloofendal_38d_partly_cloudy_puresky_1k.hdr`:

- [Kloofendal 38d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_38d_partly_cloudy_puresky).
- Greg Zaal (original) and Jarod Guest (sky edits).
- [CC0, Poly Haven](https://polyhaven.com/license).

## Surface textures

- PaintedMetal006, Concrete045 and Asphalt030: [ambientCG](https://ambientcg.com/), [CC0](https://docs.ambientcg.com/license/).
- Rock Face 03: [Poly Haven](https://polyhaven.com/a/rock_face_03), Dario Barresi (photography), Rico Cilliers (processing), [CC0](https://polyhaven.com/license).

The project stores resized texture maps for browser rendering. The original CC0 terms remain unchanged.

## Draco decoder

`public/draco/` contains Google's Draco decoder runtime for the GLB model. It retains the [Apache 2.0 license](public/draco/LICENSE). Source: [google/draco](https://github.com/google/draco).

## Application resources

The cloud sprite and procedural geometry, surface maps, shaders, camera path and interface are provided as part of the AXIOM project. Reference photos, offline source model archives, unused model variants and authoring tools are not included.

JavaScript dependencies are installed from npm under their respective licenses; they are not relicensed by the root `LICENSE`.

# Third-Party Licenses, Models, Data, and Service Attribution

RoutePilot's original project code is licensed under the [ISC License](../LICENSE). That license does **not** replace or override the separate licenses and terms that apply to third-party libraries, model weights, map styles, open data, and hosted services.

This file documents the key direct/runtime components identified during the release review. It is a **curated notice, not a generated, exhaustive Software Bill of Materials (SBOM)** for every transitive npm dependency. The exact resolved package versions in `package-lock.json` and `frontend/package-lock.json` remain authoritative; a full production-distribution audit should scan both installed dependency trees and retain required copyright/license texts.

## Key software components

| Component | Use in RoutePilot | License / notice | Upstream source |
|---|---|---|---|
| RoutePilot original code | Backend and frontend code authored for this project | ISC | [Repository LICENSE](../LICENSE) |
| AWS SDK for JavaScript v3 Bedrock Runtime | Optional Bedrock provider integration | Apache-2.0 | [aws/aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| Groq TypeScript SDK | Active Groq provider integration | Apache-2.0 | [groq/groq-typescript](https://github.com/groq/groq-typescript) |
| Model Context Protocol TypeScript client/server | MCP client and server | Check the exact resolved package/version license file. The upstream SDK documents a licensing transition, with different terms potentially applying to older contributions. | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| Pino | Backend logging | MIT | [pinojs/pino](https://github.com/pinojs/pino) |
| Zod | Validation and schemas | MIT | [colinhacks/zod](https://github.com/colinhacks/zod) |
| React / React DOM | Frontend UI | MIT | [facebook/react](https://github.com/facebook/react) |
| MapLibre GL JS | Interactive map rendering | BSD-3-Clause | [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) |
| Lucide React | UI icons | ISC | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| DOMPurify | HTML sanitization | Apache-2.0 | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) |
| Marked | Markdown parsing | MIT | [markedjs/marked](https://github.com/markedjs/marked) |
| clsx / tailwind-merge | CSS class utilities | MIT | [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge) |
| Vite / Tailwind CSS | Frontend build and styling | MIT | [vitejs/vite](https://github.com/vitejs/vite), [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| Playwright | Browser end-to-end test tooling | Apache-2.0 | [microsoft/playwright](https://github.com/microsoft/playwright) |
| Kokoro JS | On-device speech runtime | Apache-2.0 (also listed in [Local TTS documentation](LOCAL_TTS.md)) | [kokoro-js](https://github.com/hexgrad/kokoro) |
| Hugging Face Transformers.js | Model loading and inference utilities used by the local speech path | Apache-2.0 | [huggingface/transformers.js](https://github.com/huggingface/transformers.js) |
| ONNX Runtime Web | Browser-side model inference | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |

The list above focuses on major components. Development and transitive packages may carry additional license terms; do not treat this table as a replacement for their included license files.

## Kokoro model and speech assets

- **Model:** [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) declares **Apache-2.0** in its model card.
- **Runtime versions and license notes:** See [Local TTS documentation](LOCAL_TTS.md), which records the versions tested by this project.
- **eSpeak NG / phonemization:** The local TTS dependency notes identify an **GPL-3.0** eSpeak NG dependency in the speech/phonemization chain. Do not assume RoutePilot's ISC license covers this dependency. Before redistributing a built frontend or model/runtime assets, verify which eSpeak NG files are actually included in the distributed bundle and follow the applicable license/source obligations. See [eSpeak NG](https://github.com/espeak-ng/espeak-ng) and its [license files](https://github.com/espeak-ng/espeak-ng/tree/master).
- The model and voice assets are downloaded by the browser at runtime and are not stored in this repository. Review the upstream model card and asset terms before repackaging or redistributing those files.

## Map rendering, style, and map data

RoutePilot uses MapLibre GL JS with the OpenFreeMap Liberty style by default.

- **MapLibre GL JS:** BSD-3-Clause. See the [upstream license](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt).
- **OpenFreeMap:** A hosted map style/tile service; its project license is MIT. Its style assets also credit upstream OpenMapTiles components. The OpenFreeMap license notes list OpenMapTiles code under BSD-3-Clause and style design under CC BY 4.0. See [OpenFreeMap licensing notes](https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md).
- **Map attribution:** OpenFreeMap says attribution is automatically added when MapLibre is used. RoutePilot uses MapLibre's default attribution control (it does not disable the control). Keep the control visible in screenshots and demo video; do not crop out or cover the attribution.
- **OpenStreetMap data:** ODbL 1.0. Provide visible credit and make the license clear. The map's attribution should link to [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright). The expected credit is “© OpenStreetMap contributors.” See the [OSM Foundation attribution guidance](https://osmfoundation.org/wiki/Attribution_Guidelines).
- **Routing and place results:** Valhalla routes and Nominatim/Overpass geocoding and POI results are based on OpenStreetMap data. OSM's data license applies to the data, independently of the RoutePilot code license.

## Hosted APIs and operational terms

API/service terms are distinct from open-source software licenses.

- **Nominatim public service:** Follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). It specifies a maximum of one request per second for the public service, an identifying User-Agent/Referer, suitable visible attribution, and restrictions on autocomplete and bulk use. RoutePilot exposes configurable service URLs; deployments must remain within the chosen provider's policy and should not treat the public endpoint as an unrestricted production service.
- **Overpass API:** Shared public instances have their own acceptable-use and capacity limits. Keep queries bounded, retry conservatively, and use an appropriate provider/own instance if the workload grows.
- **OpenFreeMap:** Review the provider's [current terms](https://openfreemap.org/tos/) before production use; the hosted service is offered as-is and its terms may change.
- **Groq and Amazon Bedrock:** These are hosted model APIs, not software packages covered by the RoutePilot ISC license. Use is subject to each provider's service terms. RoutePilot's active demo provider is Groq; the Bedrock code path was not live-verified in the documented release pass.

## Verification before redistribution

Before distributing a production browser bundle or shipping a hosted service beyond the hackathon demo:

1. Run a license inventory against the installed dependency tree for both the repository root and `frontend/`, including transitive dependencies; review the exact package versions resolved by both lockfiles.
2. Retain required copyright notices, license texts, and any third-party notices in redistributed bundles/packages.
3. Verify the exact eSpeak NG assets included by the Kokoro/phonemization build and comply with their license obligations.
4. Run the app and verify that the MapLibre attribution control is visible and its OpenStreetMap copyright/license link is usable.
5. Recheck live API/service policies before deployment; service terms and limits can change independently of this repository.

This document is an engineering attribution checklist, not legal advice or a certification that every transitive dependency has been audited.

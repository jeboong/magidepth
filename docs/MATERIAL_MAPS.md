# 재질 · Normal · Alpha 맵: 의미와 모델

검토일: 2026-09-10. 모든 추론은 사용자 PC에서 실행되며 입력 이미지/영상을 외부 데모 사이트에 업로드하지 않습니다. 최초 선택한 AI 기능에는 인터넷 모델 다운로드가 필요합니다.

## 어떤 맵인가요?

| 앱 채널 | 의미 | 중요 한계 |
| --- | --- | --- |
| Source RGB | 원본 색상 | 조명·반사·그림자를 포함하는 입력 영상. Albedo가 아님 |
| Depth | 화면 픽셀의 상대 깊이 추정 | 미터 단위 측정이나 완전한 3D 형상 복원이 아님 |
| Normal | 표면 방향을 RGB로 표현 | Advanced는 카메라 공간 Normal. UV tangent-space normal texture가 아니며, 카메라가 바뀌면 좌표도 바뀜 |
| Alpha | 전경/배경 분리용 0–1 마스크 | 자동 추정이므로 가는 깃털·털·유리·motion blur에서 오류나 프레임간 흔들림이 생길 수 있음 |
| BaseColor | 표면의 조명 영향을 줄인 Albedo 추정 | 고유한 실제 색을 확정 복원하는 것은 아니며 학습 데이터 밖의 물체에서 조명이 남거나 색이 달라질 수 있음 |
| Metallic | 금속성 추정 | RGB 한 장으로 금속/도장/반사를 항상 구별할 수 없음 |
| Roughness | 미세 표면 거칠기 추정 | 이미지의 흐림이나 밝기와 동의어가 아니며, Fast 근사값은 실제 BRDF 측정값이 아님 |
| Specular | **가정에 기반한 grayscale F0 근사** | 스크린상의 반짝임 마스크나 실제 specular BRDF를 복원한 맵이 아님. 컬러 금속 반사도 grayscale로 축약됨 |

선택 가능한 파일은 이미지 또는 영상의 화면 좌표 맵입니다. UV 언랩, 메시 생성, 보이지 않는 뒷면의 텍스처 복원은 수행하지 않습니다.

## Fast와 Advanced

Fast의 깊이 기반 Normal 및 재질 채널은 빠른 작업용 **근사**로 표시해야 합니다. 원본 RGB를 조정한 결과를 ‘AI Albedo 복원’, 밝기 기반 값을 ‘실측 Metallic’로 표시해서는 안 됩니다. Alpha는 Fast에서도 실제 BiRefNet Lite 모델을 사용합니다. Advanced 모델 실패 시 사용자에게 알리지 않고 Fast 근사로 바꾸지 않습니다.

Advanced의 선택 경로:

- **Normal**: [`prs-eth/marigold-normals-v1-1`](https://huggingface.co/prs-eth/marigold-normals-v1-1), `MarigoldNormalsPipeline`.
- **BaseColor / Roughness / Metallic**: [`prs-eth/marigold-iid-appearance-v1-1`](https://huggingface.co/prs-eth/marigold-iid-appearance-v1-1), `MarigoldIntrinsicsPipeline`. 한 번의 appearance 추론으로 필요한 재질 결과를 함께 얻습니다.
- **Specular**: 위 AI Albedo/Metallic 결과에서 아래 F0 가정식을 계산합니다. 별도 specular AI 복원 모델을 실행한다고 표시하지 않습니다.
- **Alpha Fast**: [`ZhengPeng7/BiRefNet_lite`](https://huggingface.co/ZhengPeng7/BiRefNet_lite). 빠른 dichotomous foreground segmentation을 이용한 마스크입니다.
- **Alpha Advanced**: [`ZhengPeng7/BiRefNet-matting`](https://huggingface.co/ZhengPeng7/BiRefNet-matting). trimap-free matting 용도로 공개된 모델입니다.

Marigold appearance 모델의 BaseColor는 **sRGB**, Roughness와 Metallic은 **linear 0–1 data**입니다. pinned `model_index.json`의 두 target은 `[albedo, material]`이며 material의 R/G 채널이 각각 roughness/metallicity입니다. 데이터를 매 프레임 별도로 min/max stretch하거나 metallic/roughness에 sRGB gamma를 적용하지 않습니다. [모델 카드](https://huggingface.co/prs-eth/marigold-iid-appearance-v1-1), [Diffusers 사용 문서](https://huggingface.co/docs/diffusers/v0.33.1/using-diffusers/marigold_usage)

Normal은 X=오른쪽, Y=위, Z=관찰자 쪽인 카메라 좌표의 unit vector를 `RGB=(N+1)/2`로 표시합니다. DirectX/OpenGL의 tangent-space texture 규약과 자동으로 같지 않습니다. [공식 Normal 설명](https://huggingface.co/docs/diffusers/v0.33.1/using-diffusers/marigold_usage#surface-normals-estimation)

### Specular의 정확한 계산 의미

일반적인 metal/rough workflow의 단순화를 이용합니다. dielectric F0를 0.04로 고정하고, AI BaseColor를 sRGB에서 linear로 변환한 다음:

`F0_rgb = 0.04 × (1 − metallic) + basecolor_linear × metallic`

앱의 grayscale 채널은 `0.2126 R + 0.7152 G + 0.0722 B`입니다. 거칠기는 F0의 이 계산식에 들어가지 않습니다. dielectric index of refraction, layered coating, anisotropy, colored specular, 정확한 조명은 추정하지 않습니다. 이 식은 **제품의 명시적 근사 선택**이며, Marigold가 직접 반환하는 specular 값이 아닙니다.

[`marigold-iid-lighting-v1-1`](https://huggingface.co/prs-eth/marigold-iid-lighting-v1-1)의 residual은 `I = Albedo × DiffuseShading + Residual`에서 **non-diffuse lighting residual**입니다. 물체 고유의 F0/Specular material map과 다르므로 이 앱의 Specular 값을 대신하는 것으로 오인하지 않습니다. Lighting 모델은 이번 기본 inference 경로에 포함하지 않았습니다.

## 16 GB GPU 운용과 실제 속도

Marigold v1.1의 공식 권장 범위는 DDIM 1–4 steps이며, 모델 카드는 1–50 steps를 설명합니다. 이 앱은 1/2/4/8 steps, ensemble 1을 사용합니다. FP16 CUDA, 모델 입력 크기 선택과 배치 1을 시작점으로 삼고, 필요하지 않은 파이프라인은 다운로드하지 않습니다. 동시에 활성화하는 GPU 파이프라인을 제한하고 나머지는 CPU로 이동해 16 GB 환경의 메모리 부담을 줄입니다. 저장 해상도와 신경망 처리 해상도는 별개입니다. [모델 카드](https://huggingface.co/prs-eth/marigold-iid-appearance-v1-1), [Diffusers 가이드](https://huggingface.co/docs/diffusers/v0.33.1/using-diffusers/marigold_usage)

공식 문서의 3090 1-step depth 280 ms 등의 값은 해당 예제의 값입니다. **IID, Normal, 영상 전체 처리 또는 RTX 5070 Ti의 처리속도로 옮겨 쓰지 않습니다.** 입력이 큰 이미지로 출력될 때 후처리·업샘플링에도 시간과 메모리가 추가됩니다.

BiRefNet 저장소는 standard 모델의 RTX 4090 FP16 1024² 추론을 17 FPS / 3.45 GB로 보고합니다. Lite/Matting을 다른 해상도나 5070 Ti로 돌린 값과는 다릅니다. 앱의 Alpha 입력 크기는 선택 크기를 32의 배수로 올림합니다. 작은 크기는 빠르지만 원래 1024²로 학습된 모델의 미세 경계 성능이 떨어질 수 있습니다. [BiRefNet 공식 저장소](https://github.com/ZhengPeng7/BiRefNet)

Advanced 영상 처리는 single-image 모델을 **프레임별** 적용합니다. seed를 고정해도 시간 일관성 보장은 아니며 움직임에서 flicker가 남을 수 있습니다. 여러 채널을 요청하면 총 처리 시간이 증가합니다. 본 문서는 실측하지 않은 GPU FPS나 ‘16 GB에서 항상 동작’이라는 보장을 제공하지 않습니다.

### 로컬 실행 확인: RTX 5070 Ti

2026-09-10, 앱이 설치하는 독립 Python 3.13.14 / PyTorch 2.7.1+cu128 / RTX 5070 Ti에서 실제 로컬 영상의 첫 프레임으로 아래 경로를 실행했습니다. 입력 RGB는 960×515, 처리 크기는 392, CUDA FP16, Marigold 1 step, ensemble 1입니다. Alpha는 32 배수인 416×416에서 추론 후 입력 크기로 복원했습니다.

| 단일 `infer()` 호출 | 체크섬 검사·모델 로드·추론 포함 시간 | 해당 순차 테스트의 peak allocated VRAM |
| --- | ---: | ---: |
| Marigold Normal | 7.980초 | 2.62 GiB |
| Marigold Appearance → BaseColor / Roughness / Metallic / Specular | 3.890초 | 2.62 GiB |
| BiRefNet Lite Alpha | 2.009초 | 2.43 GiB |
| BiRefNet Matting Alpha | 1.466초 | 0.62 GiB |

모델 다운로드는 미리 끝난 상태이며 위 시간에는 매 모델 첫 로드와 SHA-256 검사가 포함됩니다. CUDA/Python 라이브러리 초기화 상태가 호출마다 다르므로 모델 간 속도 순위나 warmed FPS로 해석하지 않습니다. peak allocated는 PyTorch가 추적한 할당량이며 전체 드라이버 VRAM 점유량과 다릅니다. 모든 출력의 크기·dtype·유효 범위·비상수 여부를 확인했고 Normal, Albedo, Roughness, Alpha를 직접 시각 검사했습니다. 1 step / 낮은 처리 해상도에서는 재질 디테일이 부드러워지며 실제 재질의 정답 보장이 아닙니다.

재현용 opt-in 도구는 `backend/tests/smoke_advanced.py`입니다. 개인 테스트 영상과 생성 맵은 public repository에서 제외합니다.

## 코드, 가중치 및 배포 조건

| 구성요소 | 코드 | 가중치 / 선택 판단 |
| --- | --- | --- |
| Marigold | Apache-2.0 | **OpenRAIL++-M**. 코드의 Apache 조건을 가중치의 조건으로 표시하지 않음. 모델 사용·재배포 조건을 유지해야 함. [공식 고지](https://github.com/prs-eth/Marigold#-license), [MODEL LICENSE](https://github.com/prs-eth/Marigold/blob/main/LICENSE-MODEL.txt) |
| BiRefNet Lite / Matting | MIT | 공식 Hugging Face 모델 metadata도 MIT. 모델/코드 출처와 MIT 고지를 유지. [LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE), [Lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite), [Matting](https://huggingface.co/ZhengPeng7/BiRefNet-matting) |
| U²-Net | Apache-2.0 저장소 | 작은 saliency 대안. 이번 기본 경로는 확인 가능한 pinned Safetensors와 matting 모델을 가진 BiRefNet을 사용. [원 저장소](https://github.com/xuebinqin/U-2-Net) |
| RGB↔X / RGB2X | Adobe Research License | **noncommercial research only**. 직장 production용 기본 엔진에서 제외. [LICENSE](https://github.com/zheng95z/rgbx/blob/main/LICENSE) |
| StableDelight | Apache-2.0로 표시 | 공식 HF 가중치 metadata도 Apache-2.0. 반사 제거 모델이지 Normal/Metallic/Roughness 전체를 만드는 모델이 아님. 별도 채택 없이 검토만 함. [프로젝트](https://github.com/Stable-X/StableDelight), [모델](https://huggingface.co/Stable-X/yoso-delight-v0-4-base) |
| IntrinsicAnything | Apache-2.0 저장소 | 예제는 Albedo와 **specular shading**을 생성하며 100/200 DDIM step 경로를 제시. 별도 체크포인트 배포 조건을 확정하지 못했고 속도 목표에도 불리하므로 미채택. [원 저장소](https://github.com/zju3dv/IntrinsicAnything) |

라이선스는 엔지니어링 검토 요약이며 법률 자문이나 회사의 사용 승인 절차를 대체하지 않습니다. 특히 Marigold가 공개한 `LICENSE-MODEL.txt`의 현재 사본에는 Attachment A에 placeholder 문구가 남아 있습니다. 앱은 원문을 그대로 보존하고 이를 자체적으로 확장·삭제하거나 ‘무제한 Apache 가중치’로 설명하지 않습니다. 회사 정책상 엄격한 모델 권리 확인이 필요하면 해당 upstream과 법무 담당자에게 확인해야 합니다.

배포 사본: `backend/licenses/Marigold-CODE-Apache-2.0.txt`, `backend/licenses/Marigold-MODEL-OpenRAIL-plus-plus-M.txt`, `backend/licenses/BiRefNet-MIT.txt`. 라이선스 원문은 2026-09-10의 공개 upstream에서 복사했으며 앱의 자체 라이선스와 별개입니다.

## 고정 다운로드와 무결성

`backend/advanced_maps.py`는 고정 HF revision을 사용하고, 로드 전 가중치 SHA-256을 검사합니다. BiRefNet의 custom Python 및 config도 해시 검증 후 local snapshot에서만 로드합니다. moving `main` 브랜치의 remote code를 그대로 실행하지 않습니다. 모든 가중치는 Safetensors이며 `.bin/.pth` pickle을 모델 로더에 넘기지 않습니다.

| 모델 | 고정 revision | 주 가중치 SHA-256 |
| --- | --- | --- |
| Marigold Normals v1.1 | `09cfdd258cb281fa006cf1afcd2284376d16687d` | UNet `e90ff52ea6b56275a633cab0138ef8448fb5cffc9c1f283fb13520233b46d947` |
| Marigold IID Appearance v1.1 | `e7280a0a0fc5a0df0b36050882b3d8b77da22fd9` | UNet `6c7ab00d751edc8ac26a56d6d5bdcef600f2577b7ec708bea9cbac3fb12eda39` |
| BiRefNet Lite | `aa62cd87eafb9cc43056d08ef3615a14628b831d` | `4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815` |
| BiRefNet Matting | `eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9` | `a9875de5b1e6c8eb5fdaa8c727a82927ce442cdc87ba3abee6a77e6fa46c25bb` |

Marigold는 UNet 외에 text encoder와 VAE의 FP16 weights도 각각 검증합니다. 전체 manifest는 `advanced_maps.provenance()`로 읽을 수 있습니다. 체크섬은 원 게시자의 HF LFS metadata와 비교해 기록했으며, 런타임에도 실제 파일 바이트를 검사합니다. 모델과 테스트에 사용한 개인 미디어는 public repository에 포함하지 않습니다.

## 조사 기록

이번 재질 확장 조사에서는 Exa 검색 4회 × 요청 결과 5개, `sources_reviewed: 20`입니다. 이는 중복을 포함한 검색 결과 슬롯 수이며 고유 문서 수가 아닙니다. 본 문서의 결론은 원 저자 GitHub/HF 카드·라이선스와 Diffusers 공식 API를 직접 읽은 결과에 기반하며, 5070 Ti의 모델간 독립 benchmark 순위는 아닙니다.

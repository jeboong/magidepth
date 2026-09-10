# MagiDepth 모델 선택 근거

검토일: 2026-09-10 · 대상: Windows, NVIDIA GeForce RTX 5070 Ti 16 GB

## 결론

**영상 안정성은 Video Depth Anything Small, 빠른 1프레임 작업은 Depth Anything V2 Small을 우선 추천합니다.** 둘 다 Small 체크포인트의 Apache-2.0 조건을 확인했습니다. 이는 속도·시간적 일관성·설치 난이도·직장 배포 조건을 함께 고려한 제품 선택이지, 모든 영상과 하드웨어에서 가장 빠르거나 정확하다는 뜻은 아닙니다. 실제 제공 모드와 설치 상태는 앱에 표시됩니다. 검토한 대안이 모두 앱에 구현되어 있다는 의미는 아닙니다. [VDA](https://github.com/DepthAnything/Video-Depth-Anything), [DA V2](https://github.com/DepthAnything/Depth-Anything-V2)

| 후보 | 이 작업에서의 장점 | 한계 / 선택 판단 | 코드와 모델 조건 |
| --- | --- | --- | --- |
| **Video Depth Anything Small** | 28.4M 파라미터, 영상용 temporal head, 겹치는 구간과 keyframe을 사용하는 긴 영상 추론 | 완성 영상의 안정성을 위한 우선 후보. 이미지 모델보다 여러 프레임의 메모리와 문맥이 필요함 | 코드 Apache-2.0. **Small 가중치 Apache-2.0**. Base/Large 가중치 NC이므로 기본 배포 대상에서 제외. [공식](https://github.com/DepthAnything/Video-Depth-Anything) |
| **Depth Anything V2 Small** | 24.8M 파라미터, 단일 프레임 추론, 비교적 간단한 Windows 설치와 프리뷰 경로 | 빠른 초안·1프레임 프리렌더 우선 후보. 프레임별 추론에는 고유한 temporal head가 없어 흔들림 가능 | 코드와 **Small 가중치 Apache-2.0**. Base/Large/Giant 가중치는 NC. [공식](https://github.com/DepthAnything/Depth-Anything-V2) |
| **Depth Anything 3 Small / Base** | 다중 뷰 깊이와 카메라 pose를 함께 다루는 최신 계열. Small/Base의 라이선스는 배포에 비교적 적합 | 영상 깊이 MP4만 필요한 앱에는 더 큰 통합 범위. 공식 5070 Ti 동등 조건 속도 비교를 찾지 못했으므로 ‘더 최신이므로 더 빠름’이라고 판단하지 않음 | 코드 Apache-2.0. Small/Base 모델 Apache-2.0. Any-view Large/Giant/Nested는 NC. Monocular/Metric 별도 모델은 개별 조건 확인. [모델표](https://github.com/ByteDance-Seed/Depth-Anything-3#-model-cards), [Small 카드](https://huggingface.co/depth-anything/DA3-SMALL) |
| **DA V2 Small + ONNX Runtime / TensorRT** | 최적화된 실행 경로의 유력 후보. TensorRT 프로젝트에 Windows C++ 경로도 존재 | 독립적인 새 깊이 모델이 아닌 실행 방식. GPU별 엔진 구축, 버전 호환성, 정확도 대조, 실제 end-to-end 측정 후 도입해야 함 | 변환 코드와 원 가중치 라이선스를 각각 유지. ONNX 예제 Apache-2.0, TensorRT 예제 MIT. [ONNX](https://github.com/fabio-sim/Depth-Anything-ONNX), [TensorRT](https://github.com/spacewalk01/depth-anything-tensorrt) |
| **MiDaS 작은 모델들** | 여러 경량 모델과 오래된 배포 경로 | 공식 저장소가 archived 상태이며 단일 이미지 중심. 현재 기본값보다 구형 호환성 대안으로 검토 | 저장소 MIT. 채택 시 선택 체크포인트와 의존성의 조건을 별도 확인. [공식](https://github.com/isl-org/MiDaS) |
| **Apple Depth Pro** | 고해상도 경계와 metric depth에 초점 | 단일 이미지용. 프레임간 안정성과 가장 빠른 동영상 내보내기가 목표인 이 앱의 기본값으로 선택하지 않음 | 코드와 가중치 모두 Apple의 별도 LICENSE 적용. Apache/MIT라고 표시하면 안 됨. [공식](https://github.com/apple/ml-depth-pro), [라이선스](https://github.com/apple/ml-depth-pro/blob/main/LICENSE) |
| **DepthCrafter** | 긴 영상의 시간적 일관성을 목표로 하는 diffusion 계열 | 속도 우선의 16 GB 직장용 배포에는 부적합. **공식 라이선스가 상업·production 사용을 허용하지 않음** | 연구·교육 한정 조건이 코드와 가중치에 적용. [공식](https://github.com/Tencent/DepthCrafter), [라이선스](https://github.com/Tencent/DepthCrafter/blob/main/LICENSE) |
| **Online VDA (oVDA)** | 낮은 메모리의 온라인 영상 추론을 다룬 후속 연구 | 검토한 논문 페이지에 벤치마크가 있지만 배포할 코드·체크포인트·라이선스 조합은 검증하지 못함. 즉시 기본값으로 선정하지 않음 | 논문 자체의 CC BY 4.0을 코드/가중치 라이선스로 대체해서는 안 됨. [논문 페이지](https://openreview.net/forum?id=26S2CwuAf4) |

## 공개 속도 수치는 서로 직접 비교할 수 없습니다

아래는 **논문/작성자 저장소의 발표값**이며 MagiDepth 또는 RTX 5070 Ti 실측값이 아닙니다. GPU, 입력 크기, 워밍업, 정밀도, 배치와 포함된 처리 단계가 다릅니다.

| 발표 항목 | 발표된 조건 / 값 | 해석상의 주의 |
| --- | --- | --- |
| VDA Small | A100, 입력 `1 × 32 × 518 × 518`, FP16 **7.5 ms**, VRAM **6.8 GB**. [원문](https://github.com/DepthAnything/Video-Depth-Anything) | 논문은 프레임당 평균 latency를 설명함. 파일 decode/encode를 포함하는 5070 Ti 출력 FPS 보장은 아님 |
| VDA Large | 같은 표에서 FP16 **23.6 GB**. [원문](https://github.com/DepthAnything/Video-Depth-Anything) | 16 GB 기본 경로로 선택하지 않음. 해상도·구간을 바꾸면 필요 메모리가 달라짐 |
| DA V2 ONNX ViT-S | 작성자가 표기한 RTX 4080 12 GB, `1 × 3 × 518 × 518`, CUDA EP **13.3 ms**. CUDA 12.1 / ORT 1.18.0. [원문](https://github.com/fabio-sim/Depth-Anything-ONNX) | 오래된 실행 환경이며 이 숫자를 Blackwell에 그대로 적용할 수 없음. GPU 표기는 원문의 표기를 그대로 전달 |
| Depth Anything TensorRT Small | RTX 4090 FP16, 모델 입력 518² / 이미지 1280×720, **3 ms**, 전·후처리 포함. [원문](https://github.com/spacewalk01/depth-anything-tensorrt) | 10회 워밍업 후 마지막 inference 값. 표의 모델명만으로 V1/V2 및 전체 MP4 내보내기 시간을 단정하지 않음 |
| DA3-Streaming | A100, KITTI 11,373 frames, **8.51 FPS**, 모델 로드·워밍업·PLY 저장 제외. [원문](https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/da3_streaming/README.md) | reconstruction 작업이며 순수 깊이 MP4와 동등하지 않음. 메모리 표에서 30-frame chunk도 KITTI 504×154는 11.5 GB, TUM 504×378는 18.7 GB이므로 ‘항상 12 GB 미만’으로 홍보하면 안 됨 |
| DepthCrafter | A100, 1024×576 약 **2.1 FPS / 26 GB**, 512×256 약 **8.6 FPS / 9 GB**. [원문](https://github.com/Tencent/DepthCrafter) | 별도 비상업 조건이 있으며 품질/속도/입력 크기 비교가 다름 |
| oVDA | 논문 초록: A100 **42 FPS**, Jetson **20 FPS**. [원문](https://openreview.net/forum?id=26S2CwuAf4) | 이 초록만으로 특정 Jetson 모델, 상세 설정, 5070 Ti 속도 또는 배포 가능성을 추정하지 않음 |

DA3 Small의 설명 표에는 `0.08B`, 같은 Hugging Face 페이지의 자동 Safetensors 표시는 `34.3M`으로 서로 다릅니다. 벤치마크나 실제 모델 파라미터 집계를 대신해 하나를 확정값으로 사용하지 않았습니다. [모델 카드](https://huggingface.co/depth-anything/DA3-SMALL)

## RTX 5070 Ti / Windows 구현 기준

- NVIDIA 공식 표에서 RTX 5070 Ti는 **compute capability 12.0**입니다. Blackwell을 지원하지 않는 오래된 CUDA wheel을 설치하면 GPU가 보이더라도 실제 inference가 실패할 수 있습니다. [NVIDIA 표](https://developer.nvidia.com/cuda-gpus)
- PyTorch 2.7은 Blackwell 지원과 CUDA 12.8 wheel을 도입했습니다. 실제 배포 런타임은 **독립 CPython 3.13.14 + torch 2.7.1+cu128 + torchvision 0.22.1**이며, Windows RTX 5070 Ti에서 Depth·Advanced 모델의 실제 추론과 이미지/영상 export를 시험했습니다. 초기 조사에서 확인한 CPython 3.11 wheel이 아닌, 앱이 제공하는 3.13 환경에서 추가 검증한 결과입니다. [출시 안내](https://pytorch.org/blog/pytorch-2-7/), [공식 wheel 목록](https://download.pytorch.org/whl/cu128/torch/), [로컬 검증 기록](../backend/BENCHMARKS.md)
- 앱의 엔진 설치 검사는 필수 라이브러리 import와 CUDA 가용성을 확인합니다. 특정 모델의 실제 동작은 첫 미리보기/렌더에서 확인하며, 설치 완료만으로 모든 GPU/모델 inference 성공을 보장하지 않습니다. FP16 CUDA를 기본 시작점으로 사용하고 GPU/CPU 및 정밀도 설정을 제공합니다.
- 현재 엔진은 PyTorch 경로입니다. 별도 커스텀 셰이더, `torch.compile`, xFormers, ONNX 또는 TensorRT 엔진을 사용한다고 표시하지 않습니다. 그러한 대안의 공개 속도 수치를 현재 앱 속도로 홍보하지 않습니다.
- TensorRT 엔진은 일반적으로 운영체제와 GPU 아키텍처를 넘나드는 배포 파일이 아닙니다. 채택 시 로컬 엔진 구축/캐시 및 버전별 무효화가 필요합니다. [NVIDIA 엔진 호환성](https://docs.nvidia.com/deeplearning/tensorrt/latest/getting-started/support-matrix.html)
- 출력 해상도를 원본 크기로 보존하더라도 네트워크 입력은 작을 수 있습니다. UI는 ‘모델 입력 크기’와 ‘출력 영상 크기’를 구분해야 합니다. 크기 확대가 원래 없던 깊이 디테일을 복구하지는 않습니다.

## 영상 출력에서 지켜야 할 점

VDA의 기본 offline 추론은 시간 문맥을 활용합니다. 공식의 streaming 모드는 training-free experimental 경로이며, 작성자는 ScanNet의 d1이 0.926에서 0.836으로 낮아진 예를 보고합니다. 따라서 streaming과 offline을 같은 품질로 표시하지 않습니다. 1프레임 프리뷰 또한 시간 문맥이 있는 전체 export와 정확히 같다고 보장할 수 없습니다. [공식 설명](https://github.com/DepthAnything/Video-Depth-Anything)

상대 깊이는 미터 단위의 측정값이 아닙니다. 가깝게 흰색/멀게 검은색 표시와 반전은 시각화 설정입니다. 프레임별 min/max 재정규화는 밝기 펌핑을 만들 수 있으므로 export에는 일관된 normalization을 사용하고, temporal smoothing이 있는 경우 빠른 움직임에서 잔상이 생길 수 있음을 설명해야 합니다. 영화·합성 크리처·투명체·반사·강한 motion blur에서는 모델 추정 오류가 남을 수 있습니다.

## 배포와 업데이트 원칙

Small 모델의 Apache-2.0 조건은 상업 사용을 금지하는 라이선스와 구분됩니다. 그러나 이는 전체 앱, 미디어 codec, PyTorch/CUDA 런타임, 변환 코드 및 모든 입력 영상의 권리까지 자동 해결한다는 뜻은 아닙니다. 배포 시 해당 라이선스/NOTICE를 유지하고, 수정한 upstream 파일을 표시하며, 정확한 checkpoint와 코드 revision을 기록해야 합니다. 이 문서는 엔지니어링용 요약이며 법률 자문이 아닙니다. [VDA LICENSE](https://github.com/DepthAnything/Video-Depth-Anything/blob/main/LICENSE), [DA V2 LICENSE](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/LICENSE)

앱 업데이트와 모델 업데이트는 별개입니다. 새 모델은 고정 revision·해시·라이선스 확인과 검증 후 추가하며, 기존 모델을 조용히 다른 라이선스/출력 특성으로 교체하지 않습니다. 사용자 영상과 프레임, 결과물, 개인 경로 및 모델 cache는 public GitHub에 포함하지 않습니다.

설치 파일에는 모델 가중치와 FFmpeg 실행 파일을 포함하지 않습니다. FFmpeg는 첫 엔진 설치 때 고정된 upstream 배포본을 SHA-256 검증 후 별도로 다운로드하며, 모델은 선택 시 내려받습니다. Python/pip의 준비 리소스와 외부 라이선스는 [서드파티 고지](../THIRD_PARTY_NOTICES.md)를 확인하세요.

## 로컬 벤치마크 기록 방법

공개 자료만으로 ‘5070 Ti 최속’을 단정하지 않습니다. 실제 앱 측정에는 다음을 함께 기록합니다.

1. GPU/VRAM/드라이버, OS, torch/CUDA, 모델 checkpoint revision, FP16/FP32.
2. 입력 영상 크기/FPS/선택 프레임 수, 모델 입력 크기, 출력 codec/크기, normalization/smoothing.
3. cold start(최초 다운로드 제외), warmed preview latency, inference-only 시간, decode부터 encode까지의 전체 export 시간, peak VRAM.
4. 동일 clip과 설정에서 반복 측정한 중앙값. `처리 프레임 수 / 전체 export 시간`과 영상 자체 FPS를 구분.
5. 빠른 동작·가림·얇은 경계에서 실제 깊이 영상의 시간적 안정성도 함께 확인.

실측 전에는 빈 결과를 추정치로 채우지 않습니다. 특정 샘플의 성공은 모든 길이·해상도·드라이버에서의 성능 보장이 아닙니다.

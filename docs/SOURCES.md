# 모델 조사 출처

검토일: 2026-09-10. Exa로 **5개 검색, 요청 결과 슬롯 25개**를 검토하고 주요 페이지를 직접 읽었습니다. `sources_reviewed: 25`는 검색 요청의 `numResults` 합이며, 서로 다른 문서 25개 또는 25개 모델이라는 뜻이 아닙니다. 중복 검색 결과를 결론의 추가 표로 세지 않았습니다.

아래는 중복 URL과 GitHub README 변형을 합친 **23개 고유 1차 출처**입니다. Exa에서 내용이 제공되지 않은 잘못된 DA3 경로와 제대로 파싱되지 않은 PyTorch previous-versions 페이지는 근거에서 제외했습니다. PyTorch Windows wheel의 존재는 공식 다운로드 index에서도 직접 확인했습니다.

| # | 출처 | 확인 내용 / 출처 특성 |
| --- | --- | --- |
| 1 | [Video Depth Anything repository](https://github.com/DepthAnything/Video-Depth-Anything) | 개발자의 공식 코드·추론 옵션·A100 latency/VRAM·Small/큰 모델별 라이선스. 성능 수치는 작성자 측정이며 앱의 독립 검증이 아님 |
| 2 | [VDA code LICENSE](https://github.com/DepthAnything/Video-Depth-Anything/blob/main/LICENSE) | Apache-2.0 배포 조건 원문. 가중치별 조건은 README도 함께 확인 |
| 3 | [VDA Small model repository](https://huggingface.co/depth-anything/Video-Depth-Anything-Small) | 공식 모델 출처와 사용 경로. 모델 카드의 기본 CLI가 Large를 예시로 드는 점에 주의; 앱은 Small을 명시적으로 선택 |
| 4 | [VDA CVPR 2025 paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Chen_Video_Depth_Anything_Consistent_Depth_Estimation_for_Super-Long_Videos_CVPR_2025_paper.pdf) | 연구 저자 원논문. temporal head·keyframes·overlap·A100 프레임당 latency의 의미 |
| 5 | [Depth Anything V2 repository](https://github.com/DepthAnything/Depth-Anything-V2) | 공식 파라미터·입력 크기·영상 사용·모델별 라이선스·community acceleration 링크 |
| 6 | [DA V2 code LICENSE](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/LICENSE) | Apache-2.0 원문. 코드와 큰 가중치들의 NC 조건을 혼동하지 않음 |
| 7 | [DA V2 Small model repository](https://huggingface.co/depth-anything/Depth-Anything-V2-Small) | 공식 체크포인트와 원형 구현 예제 |
| 8 | [Depth Anything 3 repository](https://github.com/ByteDance-Seed/Depth-Anything-3) | 공식 모델별 기능과 라이선스 표, 다중 뷰/pose 지향성, 설치 범위 |
| 9 | [DA3 code LICENSE](https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/LICENSE) | Apache-2.0 코드 조건 원문 |
| 10 | [DA3 Small model card](https://huggingface.co/depth-anything/DA3-SMALL) | Apache-2.0 모델 표시, 기능, 한계. 파라미터 표와 자동 Safetensors 통계가 다르므로 확정값으로 사용하지 않음 |
| 11 | [DA3-Streaming README](https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/da3_streaming/README.md) | 작성자의 A100 전체 처리 FPS, 해상도/구간별 VRAM. 12 GB headline만으로 일반 영상 메모리를 보장할 수 없음 |
| 12 | [Depth Anything ONNX implementation](https://github.com/fabio-sim/Depth-Anything-ONNX) | 구현 작성자의 ONNX export 및 ORT 측정. 원 모델 제작자는 아니지만 해당 변환 구현의 1차 자료 |
| 13 | [Depth Anything TensorRT implementation](https://github.com/spacewalk01/depth-anything-tensorrt) | 구현 작성자의 Windows CLI/FP16 수치/측정 조건. 마지막 warmed inference를 전체 export와 혼동하지 않음 |
| 14 | [MiDaS repository](https://github.com/isl-org/MiDaS) | 원 개발팀의 모델 목록과 측정 조건. archived 상태 |
| 15 | [Apple Depth Pro repository](https://github.com/apple/ml-depth-pro) | 원 개발팀의 단일 이미지 metric depth 목표와 모델/코드 조건 안내 |
| 16 | [Apple Depth Pro LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE) | Apple 별도 사용·재배포 조건 및 하위 구성요소 고지 |
| 17 | [DepthCrafter repository](https://github.com/Tencent/DepthCrafter) | 원 개발팀의 영상 품질·A100 속도/메모리 요구량 |
| 18 | [DepthCrafter LICENSE](https://github.com/Tencent/DepthCrafter/blob/main/LICENSE) | 코드/가중치의 commercial/production 사용 제한 원문 |
| 19 | [Online VDA, 3DV 2026 OpenReview](https://openreview.net/forum?id=26S2CwuAf4) | 저자의 연구 초록 및 A100/Jetson 발표값. 이 논문 페이지로 코드·가중치 재배포 권한을 추정하지 않음 |
| 20 | [NVIDIA CUDA compute capability table](https://developer.nvidia.com/cuda-gpus) | 하드웨어 제조사의 RTX 5070 Ti compute capability 12.0 표 |
| 21 | [PyTorch 2.7 release](https://pytorch.org/blog/pytorch-2-7/) | 프레임워크 개발자의 Blackwell/CUDA 12.8 지원 도입 설명 |
| 22 | [PyTorch official CUDA 12.8 wheel index](https://download.pytorch.org/whl/cu128/torch/) | 초기 조사에서는 Windows CPython 3.11 wheel을 확인. 최종 앱은 독립 CPython 3.13.14 + torch 2.7.1 cu128을 실제 설치·추론 검증함. 로컬 측정은 backend/BENCHMARKS.md에 별도 기록 |
| 23 | [NVIDIA TensorRT support matrix](https://docs.nvidia.com/deeplearning/tensorrt/latest/getting-started/support-matrix.html) | 실행 엔진의 플랫폼·버전·GPU 아키텍처 간 호환성 제한 |

## 검색 범위와 제외 기준

서로 다른 다섯 관점으로 검색했습니다: VDA의 실제 영상 성능/조건, DA2와 DA3의 공식 모델 선택, Windows Blackwell 실행 환경, 실시간 temporal-depth 연구, DA3 Small의 코드/가중치 조건. 블로그의 ‘최고/최속’ 순위와 출처 없는 RTX 5070 Ti FPS는 결론에 사용하지 않았습니다.

이 조사는 공개 후보를 실무적으로 좁히기 위한 한정 조사입니다. 모든 모델의 직접 재현 또는 동등 조건의 독립 benchmark가 아니며, 시간에 따라 upstream 문서·라이선스·가중치가 바뀔 수 있습니다. 출시에 사용한 실제 revision과 로컬 시험 결과는 별도로 기록해야 합니다.

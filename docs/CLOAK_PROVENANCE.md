# MagiCloak: 원본 출처와 이식 범위

MagiMagic의 **MagiCloak** 탭은 소유자가 통합을 요청한 [jeboong/seedance-cloak](https://github.com/jeboong/seedance-cloak)의 처리 엔진을 Electron/shadcn UI에 연결한 포트입니다. 원본을 새 AI 모델로 재개발했다고 주장하지 않습니다.

- 고정 원본 revision: [`6f0e670f056c5ede87c0b0c390613ed6c499a455`](https://github.com/jeboong/seedance-cloak/tree/6f0e670f056c5ede87c0b0c390613ed6c499a455)
- 확인일: 2026-09-11
- 핵심 이식 위치: `backend/cloak/`
- UI 비의존 워커: `backend/cloak_daemon.py`, 표준 입출력 JSON-lines
- 입력 이미지/영상은 로컬에서만 처리합니다. 모델 다운로드 이외에 미디어를 외부 서비스에 전송하지 않습니다.

## 라이선스와 주장 범위

확인한 Seedance Cloak revision에는 **LICENSE 파일이 없습니다**. 공개 GitHub 저장소라는 이유만으로 MIT/Apache 라이선스를 추정하지 않습니다. 이 포트는 저장소 소유자의 요청에 따라 이루어졌으며 원본의 출처를 유지합니다. MagiMagic 자체 코드의 MIT 표기가 이 원본 코드에 임의의 새 라이선스를 부여한다는 의미는 아닙니다. 원본 코드의 별도 재사용/재배포 권리는 소유자와 확인해야 합니다.

원본 함수명 `adversarial_cloak`, `freq_perturb`, `semantic_evade`는 호환성과 출처 확인을 위해 유지합니다. 구현은 OpenCV/NumPy 기반의 국소 노이즈·주파수 변형·그레인/미세 워프입니다. 학습된 특정 인식기의 손실을 최적화하는 공격 모델이나 검증된 익명화 시스템으로 설명하지 않습니다. 얼굴 검출·매칭 회피율, 플랫폼 업로드 허용, 완전 익명화, 추적 방지 또는 깜빡임 완전 제거를 보장하지 않습니다.

YuNet은 [OpenCV Zoo의 공식 얼굴 검출 모델](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet)을 사용합니다. 해당 디렉터리의 코드와 가중치는 MIT이며 원문을 `backend/cloak/YuNet-LICENSE.txt`에 보존합니다. OpenCV/NumPy/FFmpeg는 기존 앱의 별도 서드파티 조건을 따릅니다.

| 모델 | 고정 revision / 무결성 |
| --- | --- |
| `face_detection_yunet_2023mar.onnx` | OpenCV Zoo `47534e27c9851bb1128ccc0102f1145e27f23f98`, 232,589 bytes |
| SHA-256 | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |

원본과 같은 2023mar 모델을 사용합니다. 최신 이름이 비슷한 모델로 자동 교체하지 않습니다. `%LOCALAPPDATA%/SeedanceCloak/models`의 기존 모델도 정확한 해시가 일치할 때만 재사용합니다. 없으면 앱의 전용 모델 캐시에 pinned 파일을 다운로드하고 크기·해시를 검증합니다. 다운로드 불가 시 원본과 같은 optional local res10 → Haar fallback을 사용하고 실제 검출기 이름을 표시합니다. res10은 자동 다운로드하지 않습니다.

## 그대로 보존한 처리

| 항목 | 보존 내용 |
| --- | --- |
| A | 2/4/8/16 다중 스케일 noise, Laplacian edge weight, eps 배율, channel jitter 0.12 |
| B | YCrCb DCT, Y strength, chroma ×0.3, keep_ratio .25/.30 |
| C | strength×40 grain, strength×2.2 warp, 원본 경계 softening |
| 얼굴 ROI | ellipse/rect feather .18, 원본 ROI 좌표 clamp와 순서 A→B→C→blend→grid |
| Tracking | IOU .3 greedy association, EMA .5, max_age8, optical flow 원본 파라미터 |
| Grid | rows/cols, thickness/auto-thickness, BGR color, opacity, margin, ellipse/rect, eye angle, dots, anti-aliasing |
| Manual Grid | tracking OFF이면 정규화 중심·너비·높이로 고정 배치, 검출 무관. 원본 단일 배치 유지 및 아래 다중 배치 확장 |
| Preview | 입력 너비 960 이하 축소 후 처리, temporal=False, 초기 얼굴 프레임 최대14개 샘플 검색 |
| Video | OpenCV decode → BGR24 pipe → FFmpeg 단일 최종 encode, 원본 FPS·크기 |
| Audio | 원본의 첫 audio stream → AAC192k, apad + shortest로 실제 video 길이까지 보존/무음 패딩 |
| Padding | 원본이 목표보다 짧을 때만 black frames, round(targetSeconds×FPS), 기본4초·뒤쪽. 앞쪽 선택은 아래 통합 확장 참조 |
| Batch | 이미지/영상 혼합, 파일마다 tracker reset, 순차 출력, 진행/렌더 preview/취소 |
| Image | Unicode-safe decode/encode, grayscale→BGR, PNG 등 지원 포맷의 원본 alpha 재삽입, 원본 품질 값 |

원본 tracker는 놓친 ID를 최대8프레임 내부 보관하지만, **현재 miss가 있는 트랙을 출력하지 않습니다**. 이를 ‘검출을 놓친 모든 프레임에도 얼굴을 계속 가림’이라고 설명하지 않습니다. grid는 얼굴을 완전히 가리는 모자이크가 아니며 A/B/C의 낮은 강도 효과도 충분한 비식별화를 보장하지 않습니다.

## 의도적인 통합 차이

- PySide6/QThread 대신 기존 MagiMagic의 Electron UI와 취소 가능한 JSON-lines 워커를 사용합니다. Torch/GPU를 필요로 하지 않으며 기존 NumPy/OpenCV만 사용합니다.
- 원본 README의 A 기본 ON 설명 대신 **실제 원본 UI 기본값인 Grid ON, A/B/C OFF**를 사용합니다.
- 사용자 화면의 옵션 표기는 **A=그리드, B=원본 A, C=원본 B, D=원본 C**입니다. 내부 `use_grid`, `methods.A/B/C` 키·수식·처리 순서·저장 설정은 바꾸지 않습니다.
- 수동 배치는 `manual_grids`로 최대16개를 지원합니다. 누락/null은 기존 `man_*` 단일 그리드와 픽셀 단위로 같고, 빈 목록은 그리드 없음입니다. 각 그리드의 기본 ROI 위치·크기는 독립적이며, 스타일은 기존 전역 GridParams를 공유합니다. 목록 순서대로 같은 그리드 함수를 호출하며 자동 추적과 내부 A/B/C 처리에는 영향을 주지 않습니다.
- 검은 화면 패딩 위치에 `pad_position: before/after`를 추가했습니다. 기본 `after`는 기존 뒤쪽 패딩과 동일합니다. `before`는 짧은 영상의 실제 읽을 수 있는 프레임 수를 확인한 뒤 부족한 검은 프레임을 앞에 넣고, 동일한 프레임 수/FPS만큼 모든 오디오 채널에 무음을 삽입합니다. 목표보다 긴 영상은 앞뒤 어느 선택에서도 이동·축소하지 않습니다. 패딩 초 값은 추가 길이가 아니라 목표 총길이입니다. 추가 프레임 계수 패스는 앞쪽 패딩이 필요한 짧은 영상에만 적용되며, 기본/뒤쪽 처리 경로는 바뀌지 않습니다.
- 수동 grid/padding만 사용하면 얼굴 검출기 다운로드·초기화를 생략합니다. 초기 `findFace:true` 요청은 얼굴 검색을 위해 검출기를 사용합니다.
- ffmpeg/ffprobe는 앱 RuntimeManager가 준비한 고정·검증 도구를 사용합니다. 원본의 별도 FFmpeg 자동 업데이트/다운로드와 무음 OpenCV writer fallback은 중복하지 않습니다. 도구가 없으면 명시적 오류로 복구를 안내합니다.
- 출력은 개별 파일 단위로 임시 저장 후 기존 파일을 덮어쓰지 않는 방식으로 공개합니다. 취소/오류 시 진행 중 임시 파일은 정리하며, 이미 완료된 앞선 배치 파일은 보존합니다.
- 8-bit 이미지 경로를 명시합니다. 16-bit 이미지를 조용히 uint8로 잘못 처리하지 않고 변환 안내를 제공합니다. JPEG 등 alpha를 지원하지 않는 출력 포맷은 투명도를 저장하지 못합니다.
- 화면의 품질 선택은 원본 품질 유지/표준/저용량 세 가지로 단순화했습니다. 백엔드는 기존 여섯 키를 계속 받아들이며 원래 CRF/preset 값을 유지합니다. 홀수 너비·높이 영상은 크기를 자르거나 변경하지 않고 자동으로 YUV444를 사용합니다. 이때 일부 플레이어/하드웨어 디코더의 호환성이 낮아질 수 있습니다.
- 원본의 임의 화이트리스트/업데이트 실행 코드를 포트하지 않습니다. 앱 설치·업데이트·테마·튜토리얼·출력 폴더 UI는 MagiMagic 공통 기능과 통합됩니다.

## 품질 프리셋은 인코더 설정입니다

| key | 영상 설정 | JPEG/WebP quality |
| --- | --- | ---: |
| visually_lossless | libx264 slow CRF14 yuv420p | 98 |
| high | libx264 medium CRF18 yuv420p | 95 |
| balanced | libx264 fast CRF20 yuv420p | 92 |
| small | libx264 veryfast CRF28 yuv420p | 82 |
| lossless | libx264 medium QP0 yuv444p | 100 |
| hevc_high | libx265 medium CRF20 yuv420p, hvc1 tag | 95 |

모든 PNG는 compression3이며 codec lossless입니다. `visually_lossless`는 원본 이름/값을 유지한 프리셋이지 원본 파일의 비트 동일성 보장이 아닙니다. `lossless` 영상도 BGR→YUV444 변환이 있으므로 원본 RGB byte 동일성은 보장하지 않습니다. 배경에 효과를 직접 적용하지 않아도 최종 lossy 인코딩과 색 변환은 배경 픽셀에 영향을 줄 수 있습니다.

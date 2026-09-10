# MagiDepth 0.1.0 · Windows public beta

이미지와 영상을 로컬 AI 맵으로 변환하는 첫 공개 베타입니다.

- 8종 맵 선택, 이미지 PNG / 영상 MP4 출력
- RTX 5070 Ti CUDA 12.8 검증, 빠른 Depth Anything V2 Small / 영상 Video Depth Anything Small
- 고급 Marigold Normal·재질 추정, BiRefNet Alpha
- 프레임 미리보기, 비교 슬라이더, 트림, 파라미터, 다크/라이트 테마
- 드래그앤드롭과 첨부 영역 Ctrl+V 이미지 붙여넣기
- 전용 엔진 설치, 저장 경로 기억, 자동 업데이트 다운로드

## 다운로드

Windows x64: **MagiDepth-Setup-0.1.0.exe**

첫 실행에서 AI 엔진 설치가 필요합니다. 인터넷과 기본 12 GB / 고급 모델 포함 25 GB 이상 여유 공간을 권장합니다. 기존 Python 설치를 변경하지 않습니다.

## 검증과 주의

RTX 5070 Ti에서 두 Depth 모델, 고급 8종 PNG 및 짧은 MP4, HEVC, 트림, 취소를 실제 검증했습니다. 별도로 격리 Python 런타임과 Electron IPC·클립보드·설정·소스 출력 통합 테스트를 수행했습니다. NSIS 설치가 정상 완료되었고, 실제 설치된 ASAR와 리소스에서도 10개 통합 검사를 통과했습니다. [실측 조건](https://github.com/jeboong/magidepth/blob/codex/initial-release/backend/BENCHMARKS.md)

미서명 공개 베타입니다. SmartScreen 경고가 있을 수 있으므로 출처·SHA-256 및 회사 설치 정책을 확인하세요. 보안 기능을 끄지 마세요.

맵은 추정 결과입니다. Fast 재질은 근사값, Normal은 카메라 공간, Specular는 F0 근사입니다. Advanced 영상 맵은 프레임간 흔들림이 생길 수 있습니다. 8-bit PNG/MP4, 오디오 제외. 미디어는 업로드하지 않으며 모델은 최초 사용 시 다운로드합니다. 모델 라이선스와 캐시 보존 정책은 README를 확인하세요.

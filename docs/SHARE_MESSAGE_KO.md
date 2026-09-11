# 동료에게 처음 보낼 메시지

작업할 때 쓰려고 만든 **MagiMagic(매지매직)** 공유합니다. 매지코의 마법을 느껴보세요 🪄

- **MagiDepth:** 이미지·영상에서 Depth / Normal / Alpha / 재질 맵 추출. 빠른·고급 모드, 프레임 미리보기, 트림 지원.
- **MagiCloak:** 얼굴 그리드 적용, 여러 격자 직접 배치·크기 조절, 이미지·영상 배치 처리, 영상 앞/뒤 검정 패딩.
- 드래그앤드롭·이미지 Ctrl+V 지원. 미디어는 서버에 올리지 않고 **내 PC에서 처리**합니다.

**설치:** https://github.com/jeboong/magidepth/releases/tag/v0.3.2

`MagiMagic-Setup-0.3.2.exe` 실행 → 시작하기 → 얼굴 왼쪽 Depth / 오른쪽 Cloak을 선택하면 됩니다.

**Windows 10/11 64비트용**이며 Depth는 NVIDIA GPU를 권장합니다. 첫 엔진·모델 준비에는 인터넷이 필요하고, 환경에 따라 **수십 분 이상** 걸릴 수 있습니다. Cloak만 쓰면 대용량 AI 엔진은 필요 없습니다.

아직 베타입니다. Cloak B/C/D는 실험적이라 효과가 없을 수 있고, AI 맵도 추정 결과입니다. 설치 파일이 미서명이므로 회사 설치 정책을 확인해 주세요. 써보시고 불편한 점이나 오류 알려주시면 반영하겠습니다!

---

## 링크와 추가 안내

- 고정 버전 설치 파일: https://github.com/jeboong/magidepth/releases/download/v0.3.2/MagiMagic-Setup-0.3.2.exe
- 이후 최신 버전: https://github.com/jeboong/magidepth/releases/latest
- 소스·자세한 사용법: https://github.com/jeboong/magidepth
- 오류 제보: https://github.com/jeboong/magidepth/issues

Depth는 RAM 16GB 이상, 기본 여유 공간 12GB 이상을 권장합니다. 고급 AI 다중 맵은 RAM 32GB·여유 공간 25GB 이상을 권장하며 영상 출력 공간은 별도입니다. NVIDIA 외 GPU 가속은 제공하지 않고 CPU 추론은 느릴 수 있습니다.

Depth 영상은 8bit 무음 MP4이며 재질·Normal·Alpha는 추정/근사 결과입니다. Cloak은 원본 오디오를 AAC로 재인코딩하고, ‘원본품질’은 무손실을 뜻하지 않습니다. Cloak은 익명화나 특정 서비스의 판정 회피를 보장하지 않습니다.

SmartScreen 경고가 나면 릴리스 출처와 SHA256SUMS.txt를 확인하고 회사의 설치 절차를 따르세요. 보안 기능을 끄지 마세요. 모델별 이용 조건은 README와 THIRD_PARTY_NOTICES.md를 확인하세요. 공개 오류 제보에는 개인 영상이나 프로젝트 경로를 올리지 마세요.

<p align="center"><img src="public/brand/magidepth.png" width="120" alt="MagiDepth icon"></p>

# MagiDepth · 매지댑스

**이미지와 영상을, 필요한 맵으로. 내 컴퓨터에서.**

Windows용 로컬 AI 맵 추출 도구입니다. Depth를 기본으로 Normal·Alpha·Base Color·Metallic·Roughness·Specular·RGB를 선택해 한 번에 저장합니다. 입력 파일을 클라우드로 업로드하지 않습니다.

## 설치와 빠른 시작

**[Windows 설치 파일과 릴리스](https://github.com/jeboong/magidepth/releases/latest)**

1. 릴리스의 `MagiDepth-Setup-X.Y.Z.exe`를 실행합니다. 관리자 권한 없이 현재 사용자 계정에 설치됩니다.
2. 첫 실행에서 **AI 엔진 설치**를 누릅니다. 전용 Python·PyTorch CUDA 12.8·영상 도구를 준비합니다. 기존 Python을 변경하지 않습니다.
3. 이미지/영상을 드래그하고 맵과 프리셋을 선택합니다. 처음 선택한 AI 모델은 자동 다운로드됩니다.
4. **프레임 미리보기**로 확인한 뒤 저장 폴더와 이름을 정하고 내보냅니다.

현재 설치 파일은 **코드 서명되지 않은 공개 베타**입니다. Windows SmartScreen 경고가 나올 수 있습니다. 출처와 릴리스 SHA-256을 확인하고 회사의 설치 정책을 따르세요. 보안 기능을 끄지 마세요.

## 기능

- PNG/JPG/WebP/BMP/TIFF 이미지, MP4/MOV/MKV/AVI/WebM 등 영상
- 첨부 영역 위에 마우스를 올리거나 영역에 포커스를 둔 상태에서 **Ctrl+V 이미지 붙여넣기**
- 8종 맵 다중 선택, 맵별 미리보기 탭, 원본/결과 비교 슬라이더
- **스피드 / 밸런스 / 디테일** 프리셋, 빠른 근사 / 고급 AI 모드
- 프레임 이동·원본 재생·구간 Trim·현재 프레임 프리렌더
- AI 입력 크기, 깊이 반전, 감마, 대비, Normal 강도, AI 스텝, GPU/CPU, 정밀도 조정
- PNG / H.264·HEVC MP4, 맵별 별도 파일, 원본 크기 또는 축소 출력
- 저장 폴더 기억, 다른 이름으로 저장, 결과 폴더 열기, 취소
- 다크/라이트/시스템 테마, 앱 내 튜토리얼, 업데이트 확인 및 다운로드

## 어떤 모드를 쓸까요?

| 작업 | 시작점 | 한계 |
|---|---|---|
| 빠른 이미지/1프레임 Depth | 스피드 · Depth Anything V2 Small | 낮은 지연, 영상에서 프레임간 흔들림 가능 |
| 최종 영상 Depth | 밸런스 · Video Depth Anything Small | 시간 문맥 사용. 입력 크기를 높이면 느려짐 |
| 가벼운 보조 맵 초안 | 빠른 처리 | Normal은 깊이 기반 근사, 재질은 영상처리 근사 |
| Normal·재질 AI 추정 | 고급 AI · Marigold | 느림, 영상 프레임간 일관성 보장 없음 |
| 피사체 Alpha | Alpha 선택 | 빠른 모드 BiRefNet Lite / 고급 모드 Matting |

Depth는 상대 깊이이며 미터 단위가 아닙니다. Normal은 카메라 공간 맵이며 UV tangent-space 베이크가 아닙니다. 재질은 RGB로부터의 추정이고 Specular는 metal-rough 기반 F0 근사입니다. 실제 물성이나 완벽한 로토스코핑을 보장하지 않습니다. [모델/한계](docs/MATERIAL_MAPS.md)

## 시스템 요구 사항

- Windows 10/11 x64. 권장 GPU: **RTX 5070 Ti 16 GB**, 호환 NVIDIA 드라이버.
- RAM 16 GB 이상, 고급 AI 다중 맵은 32 GB 이상 권장.
- 기본 설치·캐시 **12 GB 이상**, 고급 모델 포함 **25 GB 이상** 여유 공간 권장. 긴 영상의 임시 데이터와 출력 공간은 별도입니다.
- 첫 설치·새 모델·업데이트에는 인터넷이 필요합니다. 준비된 모델은 로컬 추론합니다.
- CPU 경로도 있으나 매우 느릴 수 있습니다. NVIDIA 외 GPU 가속은 제공하지 않습니다.

## 출력과 제한

이미지는 8-bit PNG, 영상은 8-bit MP4이며 **오디오 없이 맵별 저장**됩니다. 16-bit/EXR와 lossless 영상 시퀀스는 제공하지 않습니다. 압축 MP4는 정밀 데이터의 무손실 교환 형식이 아닙니다.

다중 맵은 `장면_depth.mp4`, `장면_normal.mp4`처럼 저장합니다. 기존 파일과 원본을 덮어쓰지 않으며 충돌 시 새 이름을 선택해야 합니다. Trim은 시작 프레임 포함/종료 제외, 최근접 프레임에 맞춥니다. 가변 FPS는 평균 FPS의 고정 FPS로 출력합니다.

프레임 미리보기와 최종 영상은 정규화 범위가 달라 약간 다를 수 있습니다. 고급 재질/Alpha/Normal은 프레임별 모델이어서 흔들림이 생길 수 있습니다. **모든 모델 중 가장 빠르다는 주장은 하지 않습니다.** [선정 비교](docs/MODELS.md) · [실측](backend/BENCHMARKS.md)

## 업데이트와 개인정보

자동 업데이트를 켜면 시작 후 GitHub Releases를 확인하고 새 버전을 다운로드합니다. 설치·재시작은 사용자가 선택하며 렌더 중에는 막습니다. 설정과 모델은 보존됩니다. 초기 공개 버전의 다음 버전으로의 업그레이드는 향후 릴리스에서 추가 검증합니다.

미디어는 업로드하지 않지만 다운로드 서버에는 IP 등 일반 요청 정보가 전달됩니다. 앱 자체 광고/분석 텔레메트리는 없습니다. [개인정보](PRIVACY.md) · [라이선스 고지](THIRD_PARTY_NOTICES.md)

소스는 MIT, 브랜드 이미지와 외부 모델은 별도 조건입니다. 고급 Marigold 가중치는 CreativeML OpenRAIL++-M 제한이 적용됩니다.

## 개발

```powershell
npm ci
npm run prepare:resources
npm run build:icon
npm run build
npm run desktop:dev
```

실시간 UI: 한 터미널에서 `npm run dev`, 다른 터미널에서 `$env:DEPTHDESK_DEV_URL='http://127.0.0.1:5173'; npm run desktop:dev`. `DEPTHDESK_*`와 `window.depthdesk`는 내부 호환 이름입니다. 브라우저만 열면 **UI 데모**이며 AI는 Electron에서만 실행됩니다.

```powershell
npm test
python -m pip install numpy==2.2.6 opencv-python-headless==4.11.0.86 Pillow==11.2.1
npm run test:backend
npm run dist:win
```

설치 파일은 `release/`에 생성됩니다. 개인 미디어·출력·가중치·캐시는 Git에서 제외됩니다. [백엔드](backend/README.md) · [배포](docs/RELEASING.md)

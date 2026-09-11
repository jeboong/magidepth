import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Files,
  Grid2X2,
  ScanFace,
  SlidersHorizontal,
  Sparkles,
  Download,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/primitives";
import { Button } from "../components/ui/button";
const steps = [
  {
    icon: Files,
    title: "재료는 한 번에, 여러 개도.",
    body: "이미지와 영상을 함께 드래그하거나 파일 추가를 누르세요. 작업 영역에 마우스를 둔 채 Ctrl+V로 이미지를 붙여넣을 수도 있어요. 아래 썸네일로 미리볼 파일을 바꿉니다.",
  },
  {
    icon: Grid2X2,
    title: "매지코의 격자 장난.",
    body: "A · Face Grid가 기본 주문입니다. 자동 검출·추적을 켜면 얼굴 위치를 사용합니다. 끄면 미리보기 위를 드래그해 격자를 배치하고 위치·크기를 직접 조절할 수 있어요.",
  },
  {
    icon: Sparkles,
    title: "세 가지 작은 변주.",
    body: "B는 다중 크기 노이즈, C는 주파수 변형, D는 그레인·미세 워프입니다. 이 기능은 실험적 기능이며, 적용효과가 없을 수 있습니다. 인식 차단·익명화·특정 서비스 통과를 보장하지 않습니다.",
  },
  {
    icon: ScanFace,
    title: "한 프레임씩, 눈으로 확인.",
    body: "설정을 바꾸면 잠시 뒤 미리보기가 갱신됩니다. 원본·결과·비교로 확인하고 방향키로 한 프레임씩 이동하세요. 얼굴 프레임 찾기는 영상의 일부 구간을 탐색하며, 시간축 추적은 전체 내보내기에서 적용됩니다.",
  },
  {
    icon: SlidersHorizontal,
    title: "품질과 길이까지 챙겨요.",
    body: "6가지 영상 품질을 고를 수 있습니다. 원본 오디오는 가능한 경우 함께 저장됩니다. 짧은 영상은 지정 길이까지 영상 앞 또는 뒤에 검정 화면과 무음을 추가할 수 있어요. 코덱 무손실도 색공간 변환은 포함합니다.",
  },
  {
    icon: Download,
    title: "폴더에 가지런히 담아두기.",
    body: "저장 폴더는 다음에도 기억합니다. 여러 파일은 같은 설정으로 순서대로 처리하며 원본을 덮어쓰지 않습니다. 한 파일은 다른 이름으로 저장도 가능해요. 완료 후 결과나 폴더를 바로 여세요.",
  },
];
export function CloakTutorial({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const Icon = current.icon;
  const close = () => {
    setStep(0);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="tutorial-modal max-w-[580px]">
        <div className="tutorial-visual cloak-tutorial-visual">
          <div className="tutorial-orbit orbit-one" />
          <div className="tutorial-orbit orbit-two" />
          <div className="tutorial-icon">
            <Icon size={42} strokeWidth={1.2} />
          </div>
          <span className="cloak-tutorial-letter">
            {["+", "A", "BCD", "01", "HQ", "✓"][step]}
          </span>
        </div>
        <div className="eyebrow mt-7">
          MAGICLOAK / {String(step + 1).padStart(2, "0")} OF 06
        </div>
        <DialogTitle className="mt-3 text-2xl font-semibold tracking-tight">
          {current.title}
        </DialogTitle>
        <DialogDescription className="mt-3 min-h-[100px] text-sm leading-7 text-muted-foreground">
          {current.body}
        </DialogDescription>
        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                aria-label={`Cloak 튜토리얼 ${i + 1}단계`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full ${step === i ? "w-6 bg-primary" : "w-1.5 bg-secondary"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeft />
                이전
              </Button>
            )}
            <Button onClick={() => (step === 5 ? close() : setStep(step + 1))}>
              {step === 5 ? "주문 시작" : "다음"}
              {step === 5 ? <Check /> : <ArrowRight />}
            </Button>
          </div>
        </div>
        <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
          로컬 처리 · 원본 보존 · 검출 및 인식 차단 효과 보장 없음
        </p>
      </DialogContent>
    </Dialog>
  );
}

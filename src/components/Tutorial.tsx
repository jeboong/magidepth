import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  FolderOpen,
  Layers3,
  MousePointer2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/primitives";
import { Button } from "./ui/button";
const steps = [
  {
    eyebrow: "01 / BRING YOUR FOOTAGE",
    title: "영상을 놓으면, 준비 끝.",
    description:
      "이미지나 영상을 작업 영역에 드래그하거나 ‘파일 열기’를 누르세요. 이미지를 복사한 뒤 작업 영역 위에서 Ctrl+V로 붙여넣을 수도 있습니다. 원본은 수정하지 않습니다.",
    icon: Film,
  },
  {
    eyebrow: "02 / FIND THE PERFECT FRAME",
    title: "한 프레임으로 먼저 확인하세요.",
    description:
      "Depth는 최초 셋업에 기본 포함됩니다. 추가 AI 맵에 ‘모델 다운로드’가 보이면 먼저 준비를 마친 뒤 선택하세요. ‘미리보기’로 결과를 확인하고, 재생바나 좌우 방향키로 원본 프레임을 이동합니다.",
    icon: Layers3,
  },
  {
    eyebrow: "03 / MAKE IT YOURS",
    title: "범위와 느낌을 간단하게.",
    description:
      "영상은 기본으로 전체 구간을 내보냅니다. 필요한 경우에만 ‘자르기’를 열고 필름스트립 양쪽 손잡이를 움직인 뒤 ‘자르기 적용’을 누르세요. 취소하면 이전 범위를 유지하고, 전체 영상 복원으로 자르기를 해제할 수 있습니다.",
    icon: SlidersHorizontal,
  },
  {
    eyebrow: "04 / READY TO EXPORT",
    title: "저장 위치는 한 번만.",
    description:
      "저장 폴더를 선택하고 ‘맵 내보내기’를 누르면 됩니다. 이미지는 PNG, 영상은 MP4로 맵별 저장됩니다. 폴더는 다음 실행에도 기억합니다. 모든 결과는 추정값이며 물리 측정용이 아닙니다.",
    icon: ArrowDownToLine,
  },
];
export function Tutorial({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const Icon = current.icon;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setStep(0);
        }
      }}
    >
      <DialogContent className="tutorial-modal max-w-[580px]">
        <div className="tutorial-visual">
          <div className="tutorial-orbit orbit-one" />
          <div className="tutorial-orbit orbit-two" />
          <div className="tutorial-icon">
            <Icon size={42} strokeWidth={1.2} />
          </div>
          {step === 0 && (
            <MousePointer2 className="tutorial-pointer" size={27} />
          )}{" "}
          {step === 1 && (
            <div className="tutorial-mini-timeline">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          )}
          {step === 2 && (
            <div className="tutorial-mini-sliders">
              <i />
              <i />
              <i />
            </div>
          )}
          {step === 3 && (
            <span className="tutorial-check">
              <Check size={20} />
            </span>
          )}
        </div>
        <div className="eyebrow mt-7">{current.eyebrow}</div>
        <DialogTitle className="mt-3 text-2xl font-semibold tracking-tight">
          {current.title}
        </DialogTitle>
        <DialogDescription className="mt-3 min-h-[76px] text-sm leading-7 text-muted-foreground">
          {current.description}
        </DialogDescription>
        <div className="mt-7 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                aria-label={`튜토리얼 ${i + 1}단계`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${step === i ? "w-6 bg-primary" : "w-1.5 bg-secondary"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft />
                이전
              </Button>
            )}
            <Button
              onClick={() => {
                if (step < 3) setStep(step + 1);
                else {
                  onClose();
                  setStep(0);
                }
              }}
            >
              {step < 3 ? (
                <>
                  다음
                  <ArrowRight />
                </>
              ) : (
                <>
                  시작하기
                  <Sparkles />
                </>
              )}
            </Button>
          </div>
        </div>
        <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground flex items-start gap-2">
          <FolderOpen size={14} className="shrink-0 mt-0.5" />
          모든 영상 처리는 내 컴퓨터에서. 영상은 외부 서버로 업로드되지
          않습니다.
        </div>
      </DialogContent>
    </Dialog>
  );
}

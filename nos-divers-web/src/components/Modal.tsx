import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** true 면 가운데 정렬 (alert/confirm 류), 기본은 bottom sheet */
  center?: boolean;
  /** 오버레이 클릭으로 닫히지 않도록 */
  dismissOnOverlay?: boolean;
  children: React.ReactNode;
}

/**
 * iOS WebKit 버그 회피용 Modal.
 *
 * 문제: position:fixed 요소가 `-webkit-overflow-scrolling: touch` 가 적용된
 * 스크롤 컨테이너(.page) 안에 렌더되면, viewport 가 아닌 부모 기준으로
 * containing block 이 잡혀 탭바 영역을 침범하지 못함.
 *
 * 해결: createPortal 로 document.body 에 직접 렌더링 + 안전영역 보호.
 */
export function Modal({ open, onClose, center, dismissOnOverlay = true, children }: ModalProps) {
  // body 스크롤 잠금 (모달 뒤 배경이 스크롤되는 것 방지)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!dismissOnOverlay) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  const node = (
    <div className={`modal-overlay${center ? " modal-center" : ""}`} onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

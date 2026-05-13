import { useState, useCallback, createContext, useContext } from "react";
import { createPortal } from "react-dom";

type ToastType = "info" | "success" | "error" | "warning";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  confirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  confirm: () => Promise.resolve(false),
});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve });
    });
  }, []);

  const handleConfirm = (result: boolean) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  const typeColors: Record<ToastType, string> = {
    info: "var(--primary)",
    success: "var(--success)",
    error: "var(--error)",
    warning: "var(--warning)",
  };

  // iOS WebKit 의 -webkit-overflow-scrolling 부모 영향을 피하기 위해
  // 토스트/컨펌은 document.body 에 portal 로 렌더한다.
  const overlays = (
    <>
      {/* Toast Container */}
      <div
        style={{
          position: "fixed",
          top: "max(16px, calc(env(safe-area-inset-top) + 8px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 440,
          width: "calc(100% - 32px)",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: "var(--surface)",
              border: `1px solid ${typeColors[t.type]}`,
              borderLeft: `4px solid ${typeColors[t.type]}`,
              borderRadius: 12,
              padding: "14px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--foreground)",
              boxShadow: "none",
              animation: "toast-in 0.25s ease-out",
              pointerEvents: "auto",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Confirm Dialog */}
      {confirmState && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay)",
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: 16,
              padding: 24,
              width: "100%",
              maxWidth: 300,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--foreground)",
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              {confirmState.message}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn btn-secondary"
                onClick={() => handleConfirm(false)}
              >
                취소
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleConfirm(true)}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );

  return (
    <ToastContext.Provider value={{ toast, confirm }}>
      {children}
      {typeof document !== "undefined" && createPortal(overlays, document.body)}
    </ToastContext.Provider>
  );
}

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message }: LoadingSpinnerProps) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" aria-label="Loading" />
      {message && <p className="spinner-msg">{message}</p>}
    </div>
  );
}

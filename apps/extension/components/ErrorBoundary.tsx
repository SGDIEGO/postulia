import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

interface Props {
  children: ReactNode;
  /** Nombre de la superficie que falló, para orientar al usuario. */
  surface?: string;
}

interface State {
  error: Error | null;
}

/**
 * Evita que un error de render deje la extensión en blanco: muestra el
 * problema y permite reintentar sin recargar la página.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Postulia] Error de render", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
        <div className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-card">
          <h1 className="text-lg font-semibold text-ink">Algo se rompió al dibujar la pantalla</h1>
          <p className="mt-1 text-body text-ink-muted">
            Tus datos siguen guardados en este navegador. Puedes reintentar; si vuelve a pasar,
            recarga la extensión desde <span className="font-mono">chrome://extensions</span>.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded-control bg-surface-sunken p-2 text-label text-ink-muted">
            {error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

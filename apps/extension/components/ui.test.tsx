// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Field, Modal, Toggle } from "./ui";

// React 19 exige esta bandera para que `act` no avise en el entorno de pruebas.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Toggle", () => {
  it("usa un checkbox real y avisa del nuevo valor", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<Toggle label="Avisos" checked={false} onChange={onChange} />);
    });

    const input = container.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(input).not.toBeNull();
    expect(input?.checked).toBe(false);

    act(() => input?.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("no dispara cambios cuando está deshabilitado", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <Toggle label="Avisos" description="Apagado por el administrador" checked onChange={onChange} disabled />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(input?.disabled).toBe(true);
    act(() => input?.click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("no dibuja nada mientras está cerrado", () => {
    act(() => {
      root.render(
        <Modal open={false} onClose={() => undefined} title="Detalle">
          <p>Contenido</p>
        </Modal>,
      );
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("se anuncia como diálogo, lleva el foco dentro y cierra con Escape", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Modal open onClose={onClose} title="Detalle de la oferta">
          <button type="button">Guardar</button>
        </Modal>,
      );
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");

    const titleId = dialog?.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId ?? "")?.textContent).toBe("Detalle de la oferta");

    // El foco entra en el diálogo al abrirse.
    expect(dialog?.contains(document.activeElement)).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Field", () => {
  it("muestra el error con role=alert y asocia la etiqueta al control", () => {
    act(() => {
      root.render(
        <Field label="Correo" htmlFor="email" error="Ese correo no es válido">
          <input id="email" />
        </Field>,
      );
    });

    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toBe("Ese correo no es válido");
    expect(container.querySelector("label")?.getAttribute("for")).toBe("email");
  });
});

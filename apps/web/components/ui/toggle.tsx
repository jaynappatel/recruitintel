import clsx from "clsx";

export function Toggle({
  pressed,
  onChange,
  disabled,
  label,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={clsx(
        "relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-40",
        pressed ? "bg-[var(--accent)]" : "bg-[var(--line)]",
      )}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      type="button"
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition",
          pressed ? "left-[1.125rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

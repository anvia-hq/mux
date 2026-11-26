import { Form as BaseForm } from "@base-ui/react/form";
import type { ComponentPropsWithoutRef } from "react";

export type FormProps = ComponentPropsWithoutRef<typeof BaseForm>;

export function Form({ className = "", ...props }: FormProps) {
  return <BaseForm {...props} className={className} />;
}

import { Form as BaseForm } from "@base-ui/react/form";
import type { ComponentPropsWithoutRef } from "react";

export interface FormProps extends Omit<ComponentPropsWithoutRef<typeof BaseForm>, "className"> {
  className?: string;
}

export function Form({ className = "", ...props }: FormProps) {
  return <BaseForm {...props} className={className} />;
}

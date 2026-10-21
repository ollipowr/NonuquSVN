import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import './TextInput.css';

type TextInputStyle = {
  /** `bare` drops the frame so the input can sit inside a host container. */
  variant?: 'default' | 'bare';
  size?: 'md' | 'sm';
  mono?: boolean;
};

const classes = (
  { variant = 'default', size = 'md', mono = false }: TextInputStyle,
  extra: string | undefined,
  className?: string,
) =>
  [
    'svn-input',
    extra,
    variant === 'bare' && 'svn-input--bare',
    size === 'sm' && 'svn-input--sm',
    mono && 'svn-input--mono',
    className,
  ]
    .filter(Boolean)
    .join(' ');

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'>,
    TextInputStyle {
  onChange: (value: string) => void;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    { onChange, variant, size, mono, className, type = 'text', ...input },
    ref,
  ) {
    return (
      <input
        {...input}
        ref={ref}
        type={type}
        className={classes({ variant, size, mono }, undefined, className)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  },
);

export interface TextAreaProps
  extends Omit<
      TextareaHTMLAttributes<HTMLTextAreaElement>,
      'onChange' | 'size'
    >,
    TextInputStyle {
  onChange: (value: string) => void;
}

export function TextArea({
  onChange,
  variant,
  size,
  mono,
  className,
  ...area
}: TextAreaProps) {
  return (
    <textarea
      {...area}
      className={classes({ variant, size, mono }, 'svn-input--area', className)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

import { TextInput, type TextInputProps } from './TextInput.js';
import './TextField.css';

export interface TextFieldProps extends TextInputProps {
  label: string;
}

export function TextField({ label, ...input }: TextFieldProps) {
  return (
    <label className="svn-text-field">
      <span>{label}</span>
      <TextInput {...input} />
    </label>
  );
}

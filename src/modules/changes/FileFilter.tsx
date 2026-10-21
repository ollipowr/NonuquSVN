import { Button } from '@nonu/components/ui/Button';
import { TextInput } from '@nonu/components/ui/TextInput';
import './FileFilter.css';

type FileFilterProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
};

/** Shared file/path filter used by list-oriented views. */
export function FileFilter({
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
}: FileFilterProps) {
  return (
    <div className={['svn-file-filter', className].filter(Boolean).join(' ')}>
      <span
        className="material-symbols-outlined svn-file-filter__icon"
        aria-hidden="true"
      >
        search
      </span>
      <TextInput
        variant="bare"
        size="sm"
        className="svn-file-filter__input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onChange('');
        }}
      />
      {value && (
        <Button
          variant="ghost"
          className="svn-file-filter__clear"
          title={clearLabel}
          aria-label={clearLabel}
          onClick={() => onChange('')}
        >
          <span className="material-symbols-outlined">close</span>
        </Button>
      )}
    </div>
  );
}

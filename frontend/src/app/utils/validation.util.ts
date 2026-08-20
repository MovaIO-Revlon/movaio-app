import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

type ValidatorRule = {
  fn: ValidatorFn;
  priority: number;
};

class Validator {
  private rules: ValidatorRule[] = [];
  private fieldLabel?: string;

  static string(label?: string): Validator {
    const validator = new Validator();
    validator.fieldLabel = label;
    return validator;
  }

  static number(label?: string): Validator {
    const validator = new Validator();
    validator.fieldLabel = label;
    validator.addRule(Validator.numberType(), 0);
    return validator;
  }

  static boolean(label?: string): Validator {
    const validator = new Validator();
    validator.fieldLabel = label;
    return validator;
  }

  static array(label?: string): Validator {
    const validator = new Validator();
    validator.fieldLabel = label;
    validator.addRule(Validator.arrayType(), 0);
    return validator;
  }

  required(message?: string): this {
    const label = this.fieldLabel;
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      const isEmpty =
        control.value === null ||
        control.value === undefined ||
        (typeof control.value === 'string' &&
          control.value.trim().length === 0) ||
        (Array.isArray(control.value) && control.value.length === 0);

      if (isEmpty) {
        const msg =
          message || (label ? `${label} is required` : 'field is required');
        return { required: msg };
      }
      return null;
    }, 0);
    return this;
  }

  optional(): this {
    return this;
  }

  email(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return regex.test(control.value)
        ? null
        : { email: message || 'Please enter a valid email address' };
    }, 10);
    return this;
  }

  url(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      const regex =
        /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/;
      return regex.test(control.value)
        ? null
        : { url: message || 'Please enter a valid URL' };
    }, 10);
    return this;
  }

  min(length: number, message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const value = control.value;
      const actualLength =
        typeof value === 'string'
          ? value.length
          : Array.isArray(value)
            ? value.length
            : typeof value === 'number'
              ? value
              : 0;

      if (actualLength < length) {
        const msg =
          message ||
          (typeof value === 'string'
            ? `Must be at least ${length} characters`
            : Array.isArray(value)
              ? `Must have at least ${length} items`
              : `Must be at least ${length}`);
        return { min: msg };
      }
      return null;
    }, 20);
    return this;
  }

  max(length: number, message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      const value = control.value;

      if (value === null || value === undefined || value === '') return null;

      if (typeof value === 'string') {
        if (value.length > length) {
          const unit = length === 1 ? 'character' : 'characters';
          const defaultMsg = `Must be at most ${length} ${unit} (${value.length}/${length})`;

          return { max: message || defaultMsg };
        }
      } else if (Array.isArray(value)) {
        if (value.length > length) {
          const unit = length === 1 ? 'item' : 'items';
          const defaultMsg = `Must have at most ${length} ${unit} (${value.length}/${length})`;

          return { max: message || defaultMsg };
        }
      } else if (typeof value === 'number') {
        if (value > length) {
          const defaultMsg = `Must be at most ${length}`;

          return { max: message || defaultMsg };
        }
      }

      return null;
    }, 20);

    return this;
  }

  length(exact: number, message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const value = control.value;
      const actualLength =
        typeof value === 'string'
          ? value.length
          : Array.isArray(value)
            ? value.length
            : 0;

      if (actualLength !== exact) {
        const msg = message || `Must be exactly ${exact} characters`;
        return { length: msg };
      }
      return null;
    }, 20);
    return this;
  }

  matches(pattern: RegExp, message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      return pattern.test(control.value)
        ? null
        : { matches: message || 'Invalid format' };
    }, 10);
    return this;
  }

  noSpaces(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      return /\s/.test(control.value)
        ? { noSpaces: message || 'No spaces allowed' }
        : null;
    }, 10);
    return this;
  }

  underscoreBetween(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      const regex = /^[a-zA-Z0-9]+(_[a-zA-Z0-9]+)*$/;
      return regex.test(control.value)
        ? null
        : { underscoreBetween: message || 'Use _ only between characters' };
    }, 10);
    return this;
  }

  oneOf(values: any[], message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      return values.includes(control.value)
        ? null
        : { oneOf: message || `Must be one of: ${values.join(', ')}` };
    }, 10);
    return this;
  }

  positive(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (control.value === null || control.value === undefined) return null;
      const num = Number(control.value);
      return num > 0
        ? null
        : { positive: message || 'Must be a positive number' };
    }, 10);
    return this;
  }

  negative(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (control.value === null || control.value === undefined) return null;
      const num = Number(control.value);
      return num < 0
        ? null
        : { negative: message || 'Must be a negative number' };
    }, 10);
    return this;
  }

  integer(message?: string): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (control.value === null || control.value === undefined) return null;
      const num = Number(control.value);
      return Number.isInteger(num)
        ? null
        : { integer: message || 'Must be an integer' };
    }, 10);
    return this;
  }

  test(name: string, message: string, testFn: (value: any) => boolean): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      return testFn(control.value) ? null : { [name]: message };
    }, 50);
    return this;
  }

  custom(validatorFn: ValidatorFn, priority: number = 50): this {
    this.addRule(validatorFn, priority);
    return this;
  }

  build(): ValidatorFn {
    const sortedRules = [...this.rules].sort((a, b) => a.priority - b.priority);

    return (control: AbstractControl): ValidationErrors | null => {
      for (const rule of sortedRules) {
        const error = rule.fn(control);
        if (error) {
          return error;
        }
      }
      return null;
    };
  }

  buildAll(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      let errors: ValidationErrors = {};
      let hasError = false;

      for (const rule of this.rules) {
        const error = rule.fn(control);
        if (error) {
          errors = { ...errors, ...error };
          hasError = true;
        }
      }

      return hasError ? errors : null;
    };
  }

  private addRule(fn: ValidatorFn, priority: number): void {
    this.rules.push({ fn, priority });
  }

  private static numberType(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (
        control.value === null ||
        control.value === undefined ||
        control.value === ''
      )
        return null;
      const num = Number(control.value);
      return isNaN(num) ? { type: 'Must be a valid number' } : null;
    };
  }

  private static arrayType(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (control.value === null || control.value === undefined) return null;
      return Array.isArray(control.value) ? null : { type: 'Must be an array' };
    };
  }

  json(message?: string, allowedKeys?: string[]): this {
    this.addRule((control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      if (typeof control.value !== 'string') {
        return { json: message || 'Must be a valid JSON string' };
      }

      try {
        const parsedJson = JSON.parse(control.value);

        if (allowedKeys?.length) {
          const invalidKeys = Object.keys(parsedJson).filter(
            (key) => !allowedKeys.includes(key),
          );

          if (invalidKeys.length) {
            return {
              json: `Invalid keys: ${invalidKeys.join(', ')}`,
            };
          }
        }

        return null;
      } catch {
        return { json: message || 'Invalid JSON format' };
      }
    }, 10);

    return this;
  }

  when(predicate: () => boolean): ValidatorFn {
    const builtValidator = this.build();

    return (control: AbstractControl): ValidationErrors | null => {
      return predicate() ? builtValidator(control) : null;
    };
  }
}

export const V = Validator;

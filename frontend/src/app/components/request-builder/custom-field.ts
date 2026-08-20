import { Component, input } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";

@Component({
  selector: "custom-field",
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="mb-3">
      <label [for]="inputId()" class="form-label fw-bold text-muted small mb-1">
        {{ label() }}
      </label>

      @if (type() === "select") {
        <select
          [id]="inputId()"
          [formControl]="control()"
          class="form-select font-monospace"
        >
          @for (opt of options(); track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>
      } @else if (type() === "textarea") {
        <textarea
          [id]="inputId()"
          [formControl]="control()"
          class="form-control"
          rows="3"
          [placeholder]="placeholder()"
        ></textarea>
      } @else {
        <input
          [type]="type()"
          [id]="inputId()"
          [formControl]="control()"
          class="form-control font-monospace"
          [placeholder]="placeholder()"
        />
      }

      @if (hint()) {
        <div class="form-text small text-secondary mt-1">{{ hint() }}</div>
      }
    </div>
  `,
})
export class CustomFieldComponent {
  label = input.required<string>();
  inputId = input.required<string>();
  control = input.required<FormControl<any>>();

  type = input<"text" | "textarea" | "select" | "number">("text");
  placeholder = input<string>("");
  hint = input<string>("");
  options = input<{ label: string; value: string }[]>([]);
}

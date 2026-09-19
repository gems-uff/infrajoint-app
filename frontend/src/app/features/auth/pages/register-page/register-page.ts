import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-register-page',
  imports: [RouterLink, ReactiveFormsModule, NgOptimizedImage],
  templateUrl: './register-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected togglePassword(): void {
    this.showPassword.update((value) => !value);
  }

  protected async signInWithGoogle(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { error } = await this.auth.signInWithGoogle();

    // On success the browser redirects to Google, so this only runs on failure.
    if (error) {
      this.errorMessage.set('Não foi possível conectar com o Google. Tente novamente.');
      this.submitting.set(false);
    }
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { name, email, password } = this.form.getRawValue();
    const { data, error } = await this.auth.signUp(email, password, name);

    if (error) {
      this.errorMessage.set('Não foi possível criar a conta. Tente novamente.');
      this.submitting.set(false);
      return;
    }

    // When email confirmation is enabled, Supabase returns no active session;
    // the user must confirm via email before signing in.
    if (data.session) {
      await this.router.navigate(['/dashboard']);
      return;
    }

    this.successMessage.set('Conta criada! Verifique seu email para confirmar o cadastro.');
    this.submitting.set(false);
  }
}

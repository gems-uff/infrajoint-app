import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AuthService } from '../../../../core/auth/auth.service';
import { UserAvatar } from '../../../../shared/components/user-avatar/user-avatar';

type SaveState = 'idle' | 'saving' | 'success' | 'error';

/** Largest avatar file we accept, in bytes (2 MB). */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-profile-page',
  imports: [ReactiveFormsModule, UserAvatar],
  templateUrl: './profile-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly user = this.auth.user;
  protected readonly profile = this.auth.profile;

  protected readonly saveState = signal<SaveState>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  /** Locally selected avatar file, pending upload on save. */
  private readonly selectedFile = signal<File | null>(null);
  /** Object URL for previewing the locally selected file. */
  protected readonly previewUrl = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly saving = computed(() => this.saveState() === 'saving');

  /** Re-emits whenever a form field changes, so derived signals can track edits. */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** True when the name, email, or avatar differ from the saved profile. */
  protected readonly hasChanges = computed(() => {
    this.formValue();
    const { fullName, email } = this.form.getRawValue();
    const nameChanged = fullName.trim() !== (this.profile()?.full_name ?? '');
    const emailChanged =
      email.trim().toLowerCase() !== (this.user()?.email ?? '').toLowerCase();
    return nameChanged || emailChanged || this.selectedFile() !== null;
  });

  constructor() {
    // Keep the form in sync with the server state until the user starts editing.
    effect(() => {
      const profile = this.profile();
      const user = this.user();
      if (this.form.dirty) {
        return;
      }
      this.form.setValue({
        fullName: profile?.full_name ?? '',
        email: user?.email ?? '',
      });
    });

    this.destroyRef.onDestroy(() => this.revokePreview());
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so selecting the same file again still fires a change event.
    input.value = '';
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.errorMessage.set('Selecione um arquivo de imagem válido.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      this.errorMessage.set('A imagem deve ter no máximo 2 MB.');
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.saveState.set('idle');
    this.revokePreview();
    this.selectedFile.set(file);
    this.previewUrl.set(URL.createObjectURL(file));
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    // Nothing to persist — avoid a misleading "saved" message.
    if (!this.hasChanges()) {
      return;
    }

    this.saveState.set('saving');
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { fullName, email } = this.form.getRawValue();

    // 1. Upload a newly selected avatar, if any.
    let avatarUrl = this.profile()?.avatar_url ?? null;
    const file = this.selectedFile();
    if (file) {
      const { url, error } = await this.auth.uploadAvatar(file);
      if (error) {
        this.fail('Não foi possível enviar a imagem. Tente novamente.');
        return;
      }
      avatarUrl = url;
    }

    // 2. Persist name + avatar to the profile row.
    const { error: profileError } = await this.auth.updateProfile({
      fullName: fullName.trim() || null,
      avatarUrl,
    });
    if (profileError) {
      this.fail('Não foi possível salvar as alterações. Tente novamente.');
      return;
    }

    // 3. Request an email change only when it actually changed.
    const emailChanged = email.trim().toLowerCase() !== (this.user()?.email ?? '').toLowerCase();
    if (emailChanged) {
      const { error: emailError } = await this.auth.updateEmail(email.trim());
      if (emailError) {
        this.fail('Perfil salvo, mas não foi possível atualizar o email.');
        return;
      }
    }

    this.revokePreview();
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    this.form.markAsPristine();
    this.successMessage.set(
      emailChanged
        ? 'Alterações salvas. Confirme o novo email pelo link enviado para sua caixa de entrada.'
        : 'Alterações salvas com sucesso.',
    );
    this.saveState.set('success');
  }

  private fail(message: string): void {
    this.errorMessage.set(message);
    this.saveState.set('error');
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}

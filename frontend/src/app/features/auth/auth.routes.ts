import { Routes } from '@angular/router';
import { LoginPage } from './pages/login-page/login-page';
import { RegisterPage } from './pages/register-page/register-page';

export const authRoutes: Routes = [
  {
    path: '',
    component: LoginPage,
  },
];

export const registerRoutes: Routes = [
  {
    path: '',
    component: RegisterPage,
  },
];

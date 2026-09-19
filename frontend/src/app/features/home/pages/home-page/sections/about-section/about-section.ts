import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideCheck } from '@lucide/angular';

@Component({
  selector: 'app-about-section',
  imports: [NgOptimizedImage, RouterLink, LucideCheck],
  templateUrl: './about-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutSection {}

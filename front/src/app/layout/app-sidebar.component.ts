import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AppPage, Bank } from '../models/finance.models';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  templateUrl: './app-sidebar.component.html'
})
export class AppSidebarComponent {
  @Input({ required: true }) sidebarOpen!: boolean;
  @Input({ required: true }) navPages!: Array<{ id: AppPage; label: string }>;
  @Input({ required: true }) currentPage!: AppPage;
  @Input({ required: true }) banks!: Bank[];
  @Input({ required: true }) selectedBankId!: string;
  @Input({ required: true }) allBanksId!: string;

  @Output() readonly sidebarToggle = new EventEmitter<void>();
  @Output() readonly pageChange = new EventEmitter<AppPage>();
  @Output() readonly selectedBankChange = new EventEmitter<string>();

  protected onBankSelect(value: string): void {
    this.selectedBankChange.emit(value);
  }
}

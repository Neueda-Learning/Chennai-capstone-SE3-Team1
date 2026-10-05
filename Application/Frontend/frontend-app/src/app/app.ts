import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'tui-root',
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
export class App {
  protected readonly theme = inject(ThemeService);
}

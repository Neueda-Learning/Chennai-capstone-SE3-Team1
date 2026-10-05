import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'tui-root',
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
export class App {
  // Injected for its effect: constructing the service applies the saved theme to <html>, on
  // every route, including the sign-in pages that have no shell around them.
  protected readonly theme = inject(ThemeService);
}

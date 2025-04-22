import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { D3ExampleComponent } from './d3-example/d3-example.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, D3ExampleComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'angular-project';
}

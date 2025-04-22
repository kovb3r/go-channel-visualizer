import { Component, ElementRef, OnInit } from '@angular/core';
import * as d3 from 'd3';

@Component({
  selector: 'app-d3-example',
  templateUrl: './d3-example.component.html',
  styleUrls: ['./d3-example.component.scss']
})
export class D3ExampleComponent implements OnInit {

  constructor(private el: ElementRef) {}

  ngOnInit(): void {
    this.createSvg();
  }

  private createSvg(): void {
    const svg = d3.select(this.el.nativeElement)   // Ez az aktuális komponens DOM elemére mutat
      .append('svg')
      .attr('width', 300)
      .attr('height', 200)
      .style('background', '#f0f0f0');

    svg.append('circle')
      .attr('cx', 150)
      .attr('cy', 100)
      .attr('r', 50)
      .attr('fill', 'steelblue');
  }
}


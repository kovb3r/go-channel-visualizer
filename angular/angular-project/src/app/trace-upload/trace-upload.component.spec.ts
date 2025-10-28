import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TraceUploadComponent } from './trace-upload.component';

describe('TraceUploadComponent', () => {
  let component: TraceUploadComponent;
  let fixture: ComponentFixture<TraceUploadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TraceUploadComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TraceUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

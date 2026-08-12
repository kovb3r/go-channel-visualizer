/// <reference types="jasmine" />
// a szerkesztő a build tsconfigot nézi (types: []), ezért kell ide a jasmine

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TraceUploadComponent } from './trace-upload.component';
import { FirestoreService } from '../services/firestore.service';

// a teszt ne hívjon valódi Firestore-t
const firestoreStub = {
  deleteOldTraces: () => Promise.resolve(0),
  listTraces: () => Promise.resolve([]),
  saveTrace: () => Promise.resolve(),
};

describe('TraceUploadComponent', () => {
  let component: TraceUploadComponent;
  let fixture: ComponentFixture<TraceUploadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TraceUploadComponent],
      providers: [{ provide: FirestoreService, useValue: firestoreStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(TraceUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

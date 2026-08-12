/// <reference types="jasmine" />
// a szerkesztő a build tsconfigot nézi (types: []), ezért kell ide a jasmine

import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { FirestoreService } from './services/firestore.service';

// a teszt ne hívjon valódi Firestore-t
const firestoreStub = {
  deleteOldTraces: () => Promise.resolve(0),
  listTraces: () => Promise.resolve([]),
  saveTrace: () => Promise.resolve(),
};

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [{ provide: FirestoreService, useValue: firestoreStub }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});

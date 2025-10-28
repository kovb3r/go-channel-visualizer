import { TestBed } from '@angular/core/testing';

import { TraceParserService } from './trace-parser.service';

describe('TraceParserService', () => {
  let service: TraceParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TraceParserService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

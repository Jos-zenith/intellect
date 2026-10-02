// Shared shapes for the knowledge base. Safe to import from client components.

export type UnitId = "U1" | "U2" | "U3" | "U4" | "U5";
export type AssessmentId = "IA1" | "IA2" | "END";

export interface Topic {
  id: string;
  name: string;
}

export interface Unit {
  id: UnitId;
  title: string;
  hours: number;
  endSemMarks: number;
  topics: Topic[];
}

export interface PatternPart {
  part: string;
  count: number;
  marks: number;
  rubricId: string;
  note: string;
}

export interface Assessment {
  id: AssessmentId;
  name: string;
  date: string;
  units: UnitId[];
  total: number;
  pattern: PatternPart[];
}

export interface Course {
  college: string;
  department: string;
  code: string;
  title: string;
  semester: number;
  faculty: string;
  today: string;
  assessments: Assessment[];
  gradeBands: { min: number; grade: string }[];
  units: Unit[];
}

export interface Lesson {
  id: string;
  date: string;
  unit: UnitId;
  topicIds: string[];
  title: string;
  summary: string;
  emphasis: string;
  excludeFrom?: AssessmentId[];
  addedByTeacher?: boolean;
}

export interface Pyq {
  id: string;
  year: number;
  exam: AssessmentId;
  unit: UnitId;
  topicId: string;
  marks: number;
  rubricId: string;
  question: string;
  answerKey?: string;
  examinerNote?: string;
}

export interface RubricCriterion {
  id: string;
  name: string;
  max: number;
  descriptor: string;
}

export interface Rubric {
  id: string;
  title: string;
  appliesTo: string;
  criteria: RubricCriterion[];
  deductions: string[];
  /** Where the rubric came from, shown next to every predicted mark. */
  source?: string;
}

export interface Note {
  id: string;
  unit: UnitId | null;
  topicIds: string[];
  title: string;
  text: string;
}

export interface Draft {
  id: string;
  name: string;
  /** Display label, e.g. "Aarav (after feedback)". */
  student: string;
  /** Set when this draft is a rewrite of an earlier submission. */
  resubmissionOf?: string;
  /** A test input (e.g. an off-topic answer), not a class submission. */
  probe?: boolean;
  questionId: string;
  text: string;
}

export type SourceType = "syllabus" | "lesson" | "pyq" | "rubric" | "note" | "calibration";

/** A teacher's actual mark for a paper the system had predicted. */
export interface Calibration {
  id: string;
  date: string;
  questionId: string | null;
  rubricId: string;
  student: string;
  predicted: number;
  actual: number;
  outOf: number;
  note: string;
}

export interface CalibrationStats {
  count: number;
  /** Mean absolute error, as a percentage of the question's marks. */
  meanErrorPercent: number;
  /** Positive: predictions run higher than the teacher's marks. */
  biasPercent: number;
  withinTenPercent: number;
}

export interface Source {
  id: string;
  type: SourceType;
  unit: UnitId | null;
  topicIds: string[];
  title: string;
  text: string;
}

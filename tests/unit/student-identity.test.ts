import { describe, expect, it } from "vitest";
import { domainHint, emailAllowed, parseDomains } from "@/lib/student-identity";

describe("allowed student domains", () => {
  it("parses a typed list, ignoring @, case, separators and duplicates", () => {
    expect(parseDomains(" school.edu, @Students.School.EDU;school.edu\ncollege.ac.uk ")).toEqual({
      domains: ["school.edu", "students.school.edu", "college.ac.uk"],
      invalid: [],
    });
    expect(parseDomains("school, domain.edu!, x.y").invalid).toEqual(["school", "domain.edu!", "x.y"]);
  });

  it("accepts the listed domains and their subdomains only", () => {
    expect(emailAllowed("ana@gmail.com", [])).toBe(true);
    expect(emailAllowed("ana@school.edu", ["school.edu"])).toBe(true);
    expect(emailAllowed("ana@STUDENTS.school.edu", ["school.edu"])).toBe(true);
    expect(emailAllowed("ana@evilschool.edu", ["school.edu"])).toBe(false);
    expect(emailAllowed("ana@school.edu.evil.com", ["school.edu"])).toBe(false);
    expect(emailAllowed("ana@gmail.com", ["school.edu"])).toBe(false);
  });

  it("describes the domains for students", () => {
    expect(domainHint([])).toBe("");
    expect(domainHint(["school.edu"])).toBe("school.edu");
    expect(domainHint(["a.edu", "b.edu", "c.edu"])).toBe("a.edu, b.edu or c.edu");
  });
});

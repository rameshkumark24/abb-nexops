"""
Seed the industrial_qa table from NexOps-Industrial-QA.pdf.

Run once:  python seed_qa.py
Safe to re-run — skips insert if rows already exist.
"""

import os
import re
import sys

from db import IndustrialQA, get_session, init_db


def parse_qa_from_pdf(pdf_path: str) -> list[dict]:
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber not installed. Run: pip install pdfplumber")
        sys.exit(1)

    with pdfplumber.open(pdf_path) as pdf:
        text = ""
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"

    # Find the start of section body (skip TOC)
    body_start = text.find("01. Bearings and Lubrication\n")
    if body_start == -1:
        raise ValueError("Could not locate section body in PDF")
    body_text = text[body_start:]

    # Match section headers like "01. Bearings and Lubrication"
    section_pattern = re.compile(r"^(\d{2})\.\s+([A-Za-z][^\n(]+?)(?:\s*\n)", re.MULTILINE)
    sections = []
    for m in section_pattern.finditer(body_text):
        sections.append((m.start(), int(m.group(1)), m.group(2).strip()))

    # Extract Q&A pairs within each section boundary
    qa_pattern = re.compile(r"Q(\d+)\.\s+(.*?)\nA\.\s+(.*?)(?=\nQ\d+\.|$)", re.DOTALL)
    all_qa: list[dict] = []

    for i, (pos, sec_num, sec_name) in enumerate(sections):
        end = sections[i + 1][0] if i + 1 < len(sections) else len(body_text)
        section_text = body_text[pos:end]

        for m in qa_pattern.finditer(section_text):
            q_text = " ".join(m.group(2).split())
            a_text = " ".join(m.group(3).split())
            all_qa.append(
                {
                    "section_number": sec_num,
                    "section_name": sec_name,
                    "question": q_text,
                    "answer": a_text,
                }
            )

    return all_qa


DEFAULT_PDF = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "NexOps-Industrial-QA.pdf")


def ensure_qa_seeded(pdf_path: str | None = None) -> int:
    """Load the knowledge base if the table is empty. Idempotent and safe to
    call on every startup. Returns the number of rows inserted (0 = skipped).
    Raises FileNotFoundError if the PDF is missing."""
    pdf_path = pdf_path or DEFAULT_PDF
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found at: {pdf_path}")

    init_db()
    session = get_session()
    try:
        existing = session.query(IndustrialQA).count()
        if existing > 0:
            print(f"[seed_qa] industrial_qa already contains {existing} rows — skipping seed.")
            return 0

        print(f"[seed_qa] parsing Q&A pairs from: {pdf_path}")
        qa_pairs = parse_qa_from_pdf(pdf_path)
        sections = len({qa["section_number"] for qa in qa_pairs})

        for qa in qa_pairs:
            session.add(IndustrialQA(**qa))

        session.commit()
        print(f"[seed_qa] seeded {len(qa_pairs)} industrial Q&A entries "
              f"across {sections} sections.")
        return len(qa_pairs)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def seed_qa(pdf_path: str | None = None) -> None:
    """CLI entry point: like ensure_qa_seeded, but exits non-zero on failure."""
    try:
        ensure_qa_seeded(pdf_path)
    except FileNotFoundError as e:
        print(e)
        sys.exit(1)
    except Exception as e:
        print(f"Seed failed: {e}")
        raise


if __name__ == "__main__":
    pdf_arg = sys.argv[1] if len(sys.argv) > 1 else None
    seed_qa(pdf_arg)
from hashlib import sha256
from uuid import UUID

from recruitintel_collectors.domain.classification import CLASSIFICATION_VERSION, classify_job
from recruitintel_collectors.domain.enums import EmploymentType, ExperienceLevel, RoleFamily
from recruitintel_collectors.domain.models import NormalizedJob
from recruitintel_collectors.domain.normalization import normalize_text, normalize_url
from recruitintel_collectors.redaction import redact_text

from .enums import GitHubRecordType, GitHubRepositoryType
from .models import (
    GitHubFile,
    GitHubParsedBatch,
    GitHubRepositoryConfig,
    ParsedInterviewQuestion,
    ParsedJobListing,
    ResolvedGitHubJob,
    ResolvedInterviewQuestion,
    UnresolvedGitHubRecord,
)
from .normalization import QuestionNormalizationError, normalize_interview_question
from .parsers.registry import ParserRegistry
from .resolution import GitHubCompanyResolver


def _role_family(value: str | None) -> RoleFamily | None:
    if not value:
        return None
    normalized = normalize_text(value).upper().replace(" ", "_").replace("-", "_")
    try:
        return RoleFamily(normalized)
    except ValueError:
        return None


def _external_id(
    *, repository_id: UUID, source_path: str, company_id: UUID, title: str, application_url: str
) -> str:
    document = "\x1f".join(
        (str(repository_id), source_path, str(company_id), title.casefold(), application_url)
    )
    return f"github:{sha256(document.encode()).hexdigest()}"


class GitHubRecordNormalizer:
    def __init__(self, parser_registry: ParserRegistry | None = None) -> None:
        self.parsers = parser_registry or ParserRegistry()

    def normalize_file(
        self,
        *,
        repository: GitHubRepositoryConfig,
        file: GitHubFile,
        company_resolver: GitHubCompanyResolver,
    ) -> GitHubParsedBatch:
        questions: list[ResolvedInterviewQuestion] = []
        jobs: list[ResolvedGitHubJob] = []
        unresolved: list[UnresolvedGitHubRecord] = []

        for record in self.parsers.parse(repository, file):
            if isinstance(record, ParsedInterviewQuestion):
                self._normalize_question(
                    repository=repository,
                    file=file,
                    record=record,
                    resolver=company_resolver,
                    questions=questions,
                    unresolved=unresolved,
                )
            else:
                self._normalize_job(
                    repository=repository,
                    file=file,
                    record=record,
                    resolver=company_resolver,
                    jobs=jobs,
                    unresolved=unresolved,
                )
        return GitHubParsedBatch(
            questions=tuple(questions), jobs=tuple(jobs), unresolved=tuple(unresolved)
        )

    @staticmethod
    def _normalize_question(
        *,
        repository: GitHubRepositoryConfig,
        file: GitHubFile,
        record: ParsedInterviewQuestion,
        resolver: GitHubCompanyResolver,
        questions: list[ResolvedInterviewQuestion],
        unresolved: list[UnresolvedGitHubRecord],
    ) -> None:
        company_id = resolver.resolve(record.company_name)
        if company_id is None:
            unresolved.append(
                UnresolvedGitHubRecord(
                    record_type=GitHubRecordType.INTERVIEW_QUESTION,
                    source_path=file.path,
                    source_url=file.source_url,
                    commit_sha=file.commit_sha,
                    reason="company_alias_not_resolved",
                    raw_company_name=record.company_name,
                    raw_title=record.raw_title or record.problem_url,
                    metadata=record.metadata,
                )
            )
            return
        try:
            normalized = normalize_interview_question(
                raw_title=record.raw_title,
                problem_url=record.problem_url,
                difficulty=record.difficulty,
                topics=record.topics,
            )
        except QuestionNormalizationError as exc:
            unresolved.append(
                UnresolvedGitHubRecord(
                    record_type=GitHubRecordType.INTERVIEW_QUESTION,
                    source_path=file.path,
                    source_url=file.source_url,
                    commit_sha=file.commit_sha,
                    reason=redact_text(str(exc)),
                    raw_company_name=record.company_name,
                    raw_title=record.raw_title or record.problem_url,
                    metadata=record.metadata,
                )
            )
            return

        questions.append(
            ResolvedInterviewQuestion(
                company_id=company_id,
                question=normalized,
                raw_title=record.raw_title or record.problem_url or normalized.canonical_title,
                source_path=file.path,
                source_url=file.source_url,
                commit_sha=file.commit_sha,
                role_family=_role_family(record.role_family),
                interview_stage=record.interview_stage,
                metadata={**record.metadata, "problem_url": record.problem_url},
            )
        )

    @staticmethod
    def _normalize_job(
        *,
        repository: GitHubRepositoryConfig,
        file: GitHubFile,
        record: ParsedJobListing,
        resolver: GitHubCompanyResolver,
        jobs: list[ResolvedGitHubJob],
        unresolved: list[UnresolvedGitHubRecord],
    ) -> None:
        company_id = resolver.resolve(record.company_name)
        if company_id is None:
            unresolved.append(
                UnresolvedGitHubRecord(
                    record_type=GitHubRecordType.JOB,
                    source_path=file.path,
                    source_url=file.source_url,
                    commit_sha=file.commit_sha,
                    reason="company_alias_not_resolved",
                    raw_company_name=record.company_name,
                    raw_title=record.title,
                    metadata=record.metadata,
                )
            )
            return

        title = normalize_text(record.title)
        try:
            application_url = normalize_url(normalize_text(record.application_url))
        except ValueError:
            application_url = ""
        if not title or not application_url:
            unresolved.append(
                UnresolvedGitHubRecord(
                    record_type=GitHubRecordType.JOB,
                    source_path=file.path,
                    source_url=file.source_url,
                    commit_sha=file.commit_sha,
                    reason="job_requires_title_and_https_application_url",
                    raw_company_name=record.company_name,
                    raw_title=record.title,
                    metadata=record.metadata,
                )
            )
            return

        description = normalize_text(record.description)
        classification = classify_job(title, description)
        is_internship = (
            repository.repository_type is GitHubRepositoryType.INTERNSHIP_LIST
            or classification.is_internship
        )
        is_new_grad = (
            repository.repository_type is GitHubRepositoryType.NEW_GRAD_LIST
            or classification.is_new_grad
        )
        experience_level = classification.experience_level
        employment_type = classification.employment_type
        if is_internship:
            experience_level = ExperienceLevel.INTERNSHIP
            employment_type = EmploymentType.INTERNSHIP
            is_new_grad = False
        elif is_new_grad and experience_level is ExperienceLevel.UNKNOWN:
            experience_level = ExperienceLevel.ENTRY_LEVEL

        external_id = _external_id(
            repository_id=repository.id,
            source_path=file.path,
            company_id=company_id,
            title=title,
            application_url=application_url,
        )
        normalized = NormalizedJob(
            external_id=external_id,
            title=title,
            description=description,
            location=normalize_text(record.location),
            employment_type=employment_type,
            role_family=classification.role_family,
            experience_level=experience_level,
            is_internship=is_internship,
            is_new_grad=is_new_grad,
            season=classification.season,
            graduation_years=classification.graduation_years,
            application_url=application_url,
            source_url=file.source_url,
            classification_version=CLASSIFICATION_VERSION,
            raw_payload={
                "provider": "github",
                "github_repository_id": str(repository.id),
                "repository_url": repository.repository_url,
                "source_path": file.path,
                "source_url": file.source_url,
                "commit_sha": file.commit_sha,
                "observed_row": record.metadata,
                "raw_company_name": record.company_name,
                "raw_title": record.title,
            },
        )
        jobs.append(
            ResolvedGitHubJob(
                company_id=company_id,
                source_path=file.path,
                source_url=file.source_url,
                commit_sha=file.commit_sha,
                external_id=external_id,
                job=normalized,
            )
        )

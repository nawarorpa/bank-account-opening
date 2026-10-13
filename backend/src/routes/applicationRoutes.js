import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';
import { pool } from '../db.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
|--------------------------------------------------------------------------
| FINAL UPLOAD DIRECTORY
|--------------------------------------------------------------------------
|
| Files are permanently stored here only after final submission.
|
| backend/
|   uploads/
|
*/
const uploadDir = path.resolve(
  __dirname,
  '..',
  '..',
  process.env.UPLOAD_DIR || 'uploads',
);

fs.mkdirSync(uploadDir, {
  recursive: true,
});

/*
|--------------------------------------------------------------------------
| PRIVATE STAGING DIRECTORY
|--------------------------------------------------------------------------
|
| Draft applications and draft documents are kept here.
| They are NOT stored in Oracle.
|
| backend/
|   uploads/
|     .staging/
|       <application-id>/
|
*/
const stagingRoot = path.join(
  uploadDir,
  '.staging',
);

fs.mkdirSync(stagingRoot, {
  recursive: true,
});

/*
|--------------------------------------------------------------------------
| FILE SIZE LIMIT
|--------------------------------------------------------------------------
*/
const maxSize =
  Number(process.env.MAX_FILE_SIZE_MB || 5) *
  1024 *
  1024;

/*
|--------------------------------------------------------------------------
| MULTER STORAGE
|--------------------------------------------------------------------------
|
| Uploaded documents are placed into the private staging directory first.
|
*/
const storage = multer.diskStorage({
  destination: (req, _file, callback) => {
    const dir = path.join(
      stagingRoot,
      req.params.id,
    );

    fs.mkdirSync(dir, {
      recursive: true,
    });

    callback(null, dir);
  },

  filename: (_req, file, callback) => {
    callback(
      null,
      `${crypto.randomUUID()}${path
        .extname(file.originalname)
        .toLowerCase()}`,
    );
  },
});

const upload = multer({
  storage,

  limits: {
    fileSize: maxSize,
  },
});

/*
|--------------------------------------------------------------------------
| SERVER-SIDE REQUIRED FIELDS
|--------------------------------------------------------------------------
|
| Kept here for future server-side validation.
| Currently commented out so the Flutter application can complete
| its own validation without the old registrationAuthority problem.
|
*/
/*
const requiredFields = [
  'bankName',
  'branchName',
  'country',
  'branchDistrict',
  'branchThana',
  'incorporationNumber',
  'incorporationDate',
  'registrationAuthority',
  'registeredAddress',
  'tradeLicenseNumber',
  'tradeLicenseDate',
  'tradeLicenseExpiry',
  'tinNumber',
  'officeDistrict',
  'officeThana',
  'officeAddress',
  'officeEmail',
  'officeMobile',
  'accountTitleBangla',
  'accountTitleEnglish',
  'accountNature',
  'businessSector',
  'subCategory',
  'currency',
  'entityType',
  'accountType',
  'personFullName',
  'fatherName',
  'motherName',
  'nidNumber',
  'dateOfBirth',
  'nationality',
  'gender',
  'relationWithOrganization',
  'occupation',
  'monthlyIncome',
  'sourceOfFund',
  'presentDistrict',
  'presentThana',
  'presentAddress',
  'presentEmail',
  'presentMobile',
];
*/

/*
|--------------------------------------------------------------------------
| REQUIRED DOCUMENTS
|--------------------------------------------------------------------------
*/
const requiredDocuments = [
  'Certificate of Incorporation',
  'Memorandum of Article and Association',
  'TIN Certificate',
  'Trade License',
  'National ID Card – Account Operating Person',
];

/*
|--------------------------------------------------------------------------
| APPLICATION NUMBER
|--------------------------------------------------------------------------
*/
const makeApplicationNumber = () => {
  const stamp = new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

  const suffix = crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase();

  return `INV-${stamp}-${suffix}`;
};

/*
|--------------------------------------------------------------------------
| READ STAGED APPLICATION
|--------------------------------------------------------------------------
|
| Reads applicant information from the private staging folder.
|
*/
async function readStagedApplication(id) {
  const dir = path.join(
    stagingRoot,
    id,
  );

  const appFile = path.join(
    dir,
    'application.json',
  );

  if (!fs.existsSync(appFile)) {
    return null;
  }

  const payload = JSON.parse(
    fs.readFileSync(
      appFile,
      'utf8',
    ),
  );

  const manifestFile = path.join(
    dir,
    'documents.json',
  );

  const documents = fs.existsSync(
    manifestFile,
  )
    ? JSON.parse(
        fs.readFileSync(
          manifestFile,
          'utf8',
        ),
      )
    : [];

  return {
    id,

    application_number:
      payload.application_number,

    status:
      'PENDING_SUBMISSION',

    payload:
      payload.payload,

    documents,
  };
}

/*
|--------------------------------------------------------------------------
| READ SUBMITTED APPLICATION FROM ORACLE
|--------------------------------------------------------------------------
|
| This function reads only applications that have already reached Oracle.
|
*/
async function getSubmittedApplication(
  connection,
  id,
) {
  const appResult =
    await connection.execute(
      `SELECT
         application_id AS "id",
         application_number AS "application_number",
         status AS "status",
         payload AS "payload",
         created_at AS "created_at",
         updated_at AS "updated_at",
         submitted_at AS "submitted_at",
         reviewed_at AS "reviewed_at",
         reviewed_by AS "reviewed_by",
         review_note AS "review_note"
       FROM applications
       WHERE application_id = :id`,
      {
        id,
      },
      {
        outFormat:
          oracledb.OUT_FORMAT_OBJECT,
      },
    );

  if (
    appResult.rows.length === 0
  ) {
    return null;
  }

  const docsResult =
    await connection.execute(
      `SELECT
         document_id AS "id",
         document_type AS "document_type",
         original_name AS "original_name",
         stored_name AS "stored_name",
         mime_type AS "mime_type",
         file_size AS "size_bytes",
         file_path AS "file_path",
         created_at AS "created_at"
       FROM documents
       WHERE application_id = :id
       ORDER BY created_at`,
      {
        id,
      },
      {
        outFormat:
          oracledb.OUT_FORMAT_OBJECT,
      },
    );

  const auditResult =
    await connection.execute(
      `SELECT
         audit_id AS "id",
         actor_type AS "actor_type",
         actor_username AS "actor_username",
         action AS "action",
         from_status AS "from_status",
         to_status AS "to_status",
         note AS "note",
         created_at AS "created_at"
       FROM application_audit_log
       WHERE application_id = :id
       ORDER BY created_at`,
      {
        id,
      },
      {
        outFormat:
          oracledb.OUT_FORMAT_OBJECT,
      },
    );

  const row =
    appResult.rows[0];

  let payload =
    row.payload;

  if (
    typeof payload === 'string'
  ) {
    try {
      payload = JSON.parse(
        payload,
      );
    } catch {
      // Keep legacy payload unchanged.
    }
  }

  return {
    ...row,
    payload,
    documents:
      docsResult.rows,
    audit:
      auditResult.rows,
  };
}

/*
|--------------------------------------------------------------------------
| CREATE APPLICATION
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Do NOT create a DRAFT row in Oracle.
|
| The application is stored privately in:
|
| uploads/.staging/<application-id>/
|
|--------------------------------------------------------------------------
*/
router.post(
  '/',
  async (req, res, next) => {
    try {
      if (
        !req.body ||
        typeof req.body !== 'object'
      ) {
        return res.status(400).json({
          message:
            'Application data is required.',
        });
      }

      const applicationId =
        crypto.randomUUID();

      const applicationNumber =
        makeApplicationNumber();

      const stagingDir =
        path.join(
          stagingRoot,
          applicationId,
        );

      fs.mkdirSync(
        stagingDir,
        {
          recursive: true,
        },
      );

      /*
      |--------------------------------------------------------------------------
      | SAVE APPLICATION DATA TO PRIVATE STAGING
      |--------------------------------------------------------------------------
      */
      fs.writeFileSync(
        path.join(
          stagingDir,
          'application.json',
        ),
        JSON.stringify(
          {
            application_number:
              applicationNumber,

            payload:
              req.body,

            created_at:
              new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );

      /*
      |--------------------------------------------------------------------------
      | INITIAL DOCUMENT MANIFEST
      |--------------------------------------------------------------------------
      */
      fs.writeFileSync(
        path.join(
          stagingDir,
          'documents.json',
        ),
        '[]',
        'utf8',
      );

      /*
      |--------------------------------------------------------------------------
      | RETURN PENDING SUBMISSION
      |--------------------------------------------------------------------------
      */
      return res.status(201).json({
        id:
          applicationId,

        application_number:
          applicationNumber,

        status:
          'PENDING_SUBMISSION',
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET APPLICATION
|--------------------------------------------------------------------------
|
| Used by applicant side.
|
| First tries Oracle submitted data.
| If not found, then checks private staging.
|
*/
router.get(
  '/:id',
  async (req, res, next) => {
    try {
      const connection =
        await pool.getConnection();

      try {
        const application =
          await getSubmittedApplication(
            connection,
            req.params.id,
          );

        if (application) {
          return res.json(
            application,
          );
        }
      } finally {
        await connection.close();
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK PRIVATE STAGING
      |--------------------------------------------------------------------------
      */
      const staged =
        await readStagedApplication(
          req.params.id,
        );

      if (!staged) {
        return res.status(404).json({
          message:
            'Application not found.',
        });
      }

      return res.json(staged);
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| UPLOAD DOCUMENT
|--------------------------------------------------------------------------
|
| Documents are stored ONLY in the application's private staging folder.
| They are NOT inserted into Oracle at this point.
|
|--------------------------------------------------------------------------
*/
router.post(
  '/:id/documents',
  upload.single('file'),
  async (req, res, next) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | FILE REQUIRED
      |--------------------------------------------------------------------------
      */
      if (!req.file) {
        return res.status(400).json({
          message:
            'A PDF, JPG, or PNG file is required.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | EXTENSION VALIDATION
      |--------------------------------------------------------------------------
      */
      const extension =
        path
          .extname(
            req.file.originalname ||
              '',
          )
          .toLowerCase();

      const extensionAllowed =
        [
          '.pdf',
          '.jpg',
          '.jpeg',
          '.png',
        ].includes(extension);

      /*
      |--------------------------------------------------------------------------
      | MIME VALIDATION
      |--------------------------------------------------------------------------
      */
      const mimeAllowed =
        [
          'application/pdf',
          'image/jpeg',
          'image/png',

          /*
          Android/file-picker may sometimes send
          application/octet-stream.
          Extension validation still protects the
          accepted file types.
          */
          'application/octet-stream',
        ].includes(
          req.file.mimetype,
        );

      if (
        !extensionAllowed &&
        !mimeAllowed
      ) {
        fs.rmSync(
          req.file.path,
          {
            force: true,
          },
        );

        return res.status(400).json({
          message:
            'Only PDF, JPG, JPEG and PNG files are allowed.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | STAGED APPLICATION MUST EXIST
      |--------------------------------------------------------------------------
      */
      const staged =
        await readStagedApplication(
          req.params.id,
        );

      if (!staged) {
        fs.rmSync(
          req.file.path,
          {
            force: true,
          },
        );

        return res.status(404).json({
          message:
            'Application not found.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | DOCUMENT TYPE
      |--------------------------------------------------------------------------
      */
      const {
        documentType,
      } = req.body;

      if (!documentType) {
        fs.rmSync(
          req.file.path,
          {
            force: true,
          },
        );

        return res.status(400).json({
          message:
            'documentType is required.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | DOCUMENT MANIFEST
      |--------------------------------------------------------------------------
      */
      const manifestFile =
        path.join(
          stagingRoot,
          req.params.id,
          'documents.json',
        );

      const documents =
        fs.existsSync(
          manifestFile,
        )
          ? JSON.parse(
              fs.readFileSync(
                manifestFile,
                'utf8',
              ),
            )
          : [];

      /*
      |--------------------------------------------------------------------------
      | REPLACE EXISTING DOCUMENT OF SAME TYPE
      |--------------------------------------------------------------------------
      */
      const existingIndex =
        documents.findIndex(
          (d) =>
            d.document_type ===
            documentType,
        );

      if (
        existingIndex >= 0
      ) {
        const oldFile =
          path.join(
            stagingRoot,
            req.params.id,
            documents[
              existingIndex
            ].stored_name,
          );

        fs.rmSync(
          oldFile,
          {
            force: true,
          },
        );

        documents.splice(
          existingIndex,
          1,
        );
      }

      /*
      |--------------------------------------------------------------------------
      | ADD NEW DOCUMENT TO STAGING
      |--------------------------------------------------------------------------
      */
      documents.push({
        id:
          crypto.randomUUID(),

        document_type:
          documentType,

        original_name:
          req.file.originalname,

        stored_name:
          req.file.filename,

        mime_type:
          req.file.mimetype,

        size_bytes:
          req.file.size,
      });

      /*
      |--------------------------------------------------------------------------
      | WRITE MANIFEST
      |--------------------------------------------------------------------------
      */
      fs.writeFileSync(
        manifestFile,
        JSON.stringify(
          documents,
          null,
          2,
        ),
        'utf8',
      );

      /*
      |--------------------------------------------------------------------------
      | RETURN SUCCESS
      |--------------------------------------------------------------------------
      */
      return res.status(201).json({
        document_type:
          documentType,

        original_name:
          req.file.originalname,

        mime_type:
          req.file.mimetype,

        size_bytes:
          req.file.size,
      });
    } catch (error) {
      /*
      |--------------------------------------------------------------------------
      | CLEAN UP FAILED UPLOAD
      |--------------------------------------------------------------------------
      */
      if (
        req.file?.path
      ) {
        fs.rmSync(
          req.file.path,
          {
            force: true,
          },
        );
      }

      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| FINAL SUBMISSION
|--------------------------------------------------------------------------
|
| THIS IS THE ONLY PLACE WHERE:
|
| 1. Application enters Oracle.
| 2. Documents enter Oracle.
| 3. Documents leave the private staging folder.
|
|--------------------------------------------------------------------------
*/
router.post(
  '/:id/submit',
  async (req, res, next) => {
    const movedFiles = [];

    try {
      /*
      |--------------------------------------------------------------------------
      | READ PRIVATE STAGED APPLICATION
      |--------------------------------------------------------------------------
      */
      const staged =
        await readStagedApplication(
          req.params.id,
        );

      if (!staged) {
        return res.status(404).json({
          message:
            'Application not found.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | REQUIRED DOCUMENT CHECK
      |--------------------------------------------------------------------------
      */
      const missingDocs =
        requiredDocuments.filter(
          (type) =>
            !staged.documents.some(
              (doc) =>
                doc.document_type ===
                type,
            ),
        );

      if (
        missingDocs.length
      ) {
        return res.status(400).json({
          message:
            'Required documents are missing.',

          documents:
            missingDocs,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | ORACLE CONNECTION
      |--------------------------------------------------------------------------
      */
      const connection =
        await pool.getConnection();

      try {
        const applicationId =
          req.params.id;

        const finalFiles = [];

        /*
        |--------------------------------------------------------------------------
        | MOVE DOCUMENTS FROM STAGING TO PERMANENT UPLOAD DIRECTORY
        |--------------------------------------------------------------------------
        */
        for (
          const doc of staged.documents
        ) {
          const from =
            path.join(
              stagingRoot,
              applicationId,
              doc.stored_name,
            );

          const to =
            path.join(
              uploadDir,
              doc.stored_name,
            );

          fs.renameSync(
            from,
            to,
          );

          movedFiles.push({
            from,
            to,
          });

          finalFiles.push({
            ...doc,

            file_path:
              doc.stored_name,
          });
        }

        /*
        |--------------------------------------------------------------------------
        | INSERT FINAL APPLICATION INTO ORACLE
        |--------------------------------------------------------------------------
        |
        | IMPORTANT:
        | Status is SUBMITTED.
        | There is NO DRAFT INSERT.
        |
        */
        await connection.execute(
          `INSERT INTO applications (
             application_id,
             application_number,
             status,
             payload,
             created_at,
             updated_at,
             submitted_at
           ) VALUES (
             :applicationId,
             :applicationNumber,
             'SUBMITTED',
             :payload,
             SYSTIMESTAMP,
             SYSTIMESTAMP,
             SYSTIMESTAMP
           )`,
          {
            applicationId,

            applicationNumber:
              staged.application_number,

            payload:
              JSON.stringify(
                staged.payload,
              ),
          },
          {
            autoCommit: false,
          },
        );

        /*
        |--------------------------------------------------------------------------
        | INSERT FINAL DOCUMENTS INTO ORACLE
        |--------------------------------------------------------------------------
        |
        | Oracle column is FILE_SIZE.
        |
        */
        for (
          const doc of finalFiles
        ) {
          await connection.execute(
            `INSERT INTO documents (
               document_id,
               application_id,
               document_type,
               original_name,
               stored_name,
               mime_type,
               file_size,
               file_path,
               created_at
             ) VALUES (
               :documentId,
               :applicationId,
               :documentType,
               :originalName,
               :storedName,
               :mimeType,
               :fileSize,
               :filePath,
               SYSTIMESTAMP
             )`,
            {
              documentId:
                doc.id,

              applicationId,

              documentType:
                doc.document_type,

              originalName:
                doc.original_name,

              storedName:
                doc.stored_name,

              mimeType:
                doc.mime_type,

              fileSize:
                doc.size_bytes,

              filePath:
                doc.file_path,
            },
            {
              autoCommit: false,
            },
          );

          /*
          |--------------------------------------------------------------------------
          | DOCUMENT AUDIT LOG
          |--------------------------------------------------------------------------
          */
          await connection.execute(
            `INSERT INTO application_audit_log (
               audit_id,
               application_id,
               actor_type,
               actor_username,
               action,
               note,
               created_at
             ) VALUES (
               :auditId,
               :applicationId,
               'SYSTEM',
               'applicant',
               'DOCUMENT_UPLOAD',
               :note,
               SYSTIMESTAMP
             )`,
            {
              auditId:
                crypto.randomUUID(),

              applicationId,

              note:
                doc.document_type,
            },
            {
              autoCommit: false,
            },
          );
        }

        /*
        |--------------------------------------------------------------------------
        | SUBMITTED AUDIT LOG
        |--------------------------------------------------------------------------
        */
        await connection.execute(
          `INSERT INTO application_audit_log (
             audit_id,
             application_id,
             actor_type,
             actor_username,
             action,
             from_status,
             to_status,
             note,
             created_at
           ) VALUES (
             :auditId,
             :applicationId,
             'SYSTEM',
             'applicant',
             'SUBMITTED',
             NULL,
             'SUBMITTED',
             NULL,
             SYSTIMESTAMP
           )`,
          {
            auditId:
              crypto.randomUUID(),

            applicationId,
          },
          {
            autoCommit: false,
          },
        );

        /*
        |--------------------------------------------------------------------------
        | COMMIT EVERYTHING
        |--------------------------------------------------------------------------
        */
        await connection.commit();

        /*
        |--------------------------------------------------------------------------
        | DELETE PRIVATE STAGING DIRECTORY
        |--------------------------------------------------------------------------
        */
        fs.rmSync(
          path.join(
            stagingRoot,
            applicationId,
          ),
          {
            recursive: true,
            force: true,
          },
        );

        /*
        |--------------------------------------------------------------------------
        | RETURN SUBMISSION RESULT
        |--------------------------------------------------------------------------
        */
        return res.json({
          id:
            applicationId,

          application_number:
            staged.application_number,

          status:
            'SUBMITTED',

          submitted_at:
            new Date().toISOString(),
        });
      } catch (error) {
        /*
        |--------------------------------------------------------------------------
        | ROLLBACK ORACLE
        |--------------------------------------------------------------------------
        */
        try {
          await connection.rollback();
        } catch {}

        /*
        |--------------------------------------------------------------------------
        | MOVE DOCUMENTS BACK TO STAGING
        |--------------------------------------------------------------------------
        */
        for (
          const moved of movedFiles.reverse()
        ) {
          if (
            fs.existsSync(
              moved.to,
            )
          ) {
            fs.renameSync(
              moved.to,
              moved.from,
            );
          }
        }

        throw error;
      } finally {
        await connection.close();
      }
    } catch (error) {
      next(error);
    }
  },
);

export default router;
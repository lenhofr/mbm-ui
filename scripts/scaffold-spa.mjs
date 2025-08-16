#!/usr/bin/env node
// Simple template generator for cloning the static SPA + Terraform + CI setup.
// Usage:
//   node scripts/scaffold-spa.mjs --target ../my-new-spa --app-name "App" \
//     --bucket-name my-bucket-123 --domain app.example.com --region us-east-1 \
//     [--init-package] [--readme] [--with-spa]

import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function replaceInFile(filePath, replaces) {
  let txt = fs.readFileSync(filePath, 'utf8');
  for (const [pattern, value] of replaces) {
    txt = txt.replace(new RegExp(pattern, 'g'), value);
  }
  fs.writeFileSync(filePath, txt);
}

function walkFiles(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, cb);
    else if (entry.isFile()) cb(p);
  }
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 214);
}

function updateWorkflowName(filePath, appName) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const suffix = ` - ${appName}`;
  const newTxt = txt.replace(/^name:\s*(.+)$/m, (m, base) => {
    if (base.endsWith(suffix)) return m;
    return `name: ${base}${suffix}`;
  });
  if (newTxt !== txt) fs.writeFileSync(filePath, newTxt);
}

function writeREADME(outRoot, { appName, bucketName, domain, region }) {
  const readme = `# ${appName}\n\nStatic SPA on AWS (S3 + CloudFront + ACM + Route53)\n\nValues\n- Domain: ${domain}\n- Bucket: ${bucketName}\n- Region: ${region}\n\n## Bootstrap\n\n1. Review terraform/backend.tf and set your remote state bucket/key.\n2. Update any remaining variables in terraform/variables.tf (or main.tf locals).\n3. Plan & apply:\n\n\`\`\`bash\ncd terraform\nterraform init\nterraform fmt -recursive\nterraform plan -out=tfplan\nterraform apply tfplan\n\`\`\`\n\n4. Build & deploy the front end (from repo root):\n\n\`\`\`bash\nnpm run build # if app exists\naws s3 sync dist s3://${bucketName} --delete\naws cloudfront create-invalidation --distribution-id <YOUR_CF_ID> --paths '/*'\n\`\`\`\n\nCI\n- PRs run Terraform plan (see .github/workflows/terraform-plan.yml).\n- Merges to main apply Terraform and deploy the site (deploy.yml).\n\nNotes\n- Consider switching CI to OIDC later; see docs/github-oidc.md (if present).\n- Logs are written to the CloudFront logs bucket configured in terraform/main.tf.\n`;
  fs.writeFileSync(path.join(outRoot, 'README.md'), readme);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
  console.log(`Usage:\n  node scripts/scaffold-spa.mjs --target <dir> --app-name <name> \
  --bucket-name <bucket> --domain <domain> --region <region> [--init-package] [--readme] [--with-spa]\n`);
    process.exit(0);
  }
  const target = args.target;
  if (!target) {
    console.error('Missing --target <path>');
    process.exit(1);
  }
  const appName = args['app-name'] || 'My Static SPA';
  const bucketName = args['bucket-name'] || 'my-static-spa-bucket-CHANGE-ME';
  const domain = args['domain'] || 'example.com';
  const region = args['region'] || 'us-east-1';
  const wwwDomain = `www.${domain.replace(/^www\./i, '')}`;
  const initPackage = Boolean(args['init-package']);
  const emitReadme = Boolean(args['readme']);
  const withSpa = Boolean(args['with-spa']);

  const root = process.cwd();
  const outRoot = path.resolve(root, target);
  ensureDir(outRoot);

  // Copy selective folders
  const toCopy = [
    ['terraform', 'terraform'],
    ['.github/workflows', '.github/workflows'],
    ['scripts/pre-commit.sh', 'scripts/pre-commit.sh']
  ];

  for (const [srcRel, destRel] of toCopy) {
    const src = path.join(root, srcRel);
    const dest = path.join(outRoot, destRel);
    if (!fs.existsSync(src)) continue;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) copyDir(src, dest);
    else {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
    }
  }

  // Optionally copy starter SPA skeleton
  if (withSpa) {
    const spaTpl = path.join(root, 'templates', 'spa');
    if (fs.existsSync(spaTpl)) {
      copyDir(spaTpl, outRoot);
      // If we copied a package.json for the SPA, try to merge app name
      const pkgPath = path.join(outRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          pkg.name = slugify(appName) || pkg.name || 'my-static-spa';
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        } catch {}
      }
    }
  }

  // Token replacements in Terraform and workflows
  const replacements = [
    // Domains
    ['mealsbymaggie\\.com', domain.replace('.', '\\.')],
    ['www\\.mealsbymaggie\\.com', wwwDomain.replace('.', '\\.')],
    // Bucket name (default from this repo)
    ['mqm-ui-infra-217354297026', bucketName.replace('.', '\\.')],
    // Region
    ['us-east-1', region],
    // Friendly Name tag occurrences
    ['mbm-site', appName.replace(/[-\\s]+/g, '-')],
  ];

  // Apply replacements to relevant files
  const replaceGlobs = [
    path.join(outRoot, 'terraform'),
    path.join(outRoot, '.github', 'workflows'),
  ];
  for (const base of replaceGlobs) {
    if (!fs.existsSync(base)) continue;
    walkFiles(base, p => {
      // Only mutate text files we expect
      if (/\.(tf|tfvars|ya?ml|yml|md|json|ts|tsx)$/i.test(p) || /deploy\.yml$/.test(p)) {
        replaceInFile(p, replacements);
      }
      // Also adjust workflow 'name:' for clarity
      if (/\.ya?ml$/i.test(p) && p.includes(path.join('.github', 'workflows'))) {
        updateWorkflowName(p, appName);
      }
    });
  }

  // Optionally initialize a basic package.json if not present
  const pkgPath = path.join(outRoot, 'package.json');
  if (initPackage && !fs.existsSync(pkgPath)) {
    const pkg = {
      name: slugify(appName) || 'my-static-spa',
      version: '0.1.0',
      private: true,
      scripts: {
        'tf:fmt': 'terraform fmt -recursive',
        'tf:fmt:check': 'terraform fmt -recursive -check',
        'install-hooks': 'mkdir -p .githooks && cp scripts/pre-commit.sh .githooks/pre-commit && chmod +x .githooks/pre-commit && git config core.hooksPath .githooks'
      }
    };
    ensureDir(path.join(outRoot, 'scripts'));
    // Ensure pre-commit copied
    const srcHook = path.join(root, 'scripts', 'pre-commit.sh');
    const dstHook = path.join(outRoot, 'scripts', 'pre-commit.sh');
    if (fs.existsSync(srcHook)) {
      fs.copyFileSync(srcHook, dstHook);
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  }

  // Optionally emit a tailored README
  if (emitReadme) {
    writeREADME(outRoot, { appName, bucketName, domain, region });
  }

  // Final message
  console.log('Scaffold complete at:', outRoot);
  console.log('Next: review terraform/backend.tf and variables, then run:');
  console.log('  cd', path.relative(root, path.join(outRoot, 'terraform')));
  console.log('  terraform init && terraform plan');
}

main();

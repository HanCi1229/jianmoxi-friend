#!/usr/bin/env python3
"""Build and sign the dependency-free Android shell using the official SDK tools."""
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'android'
BUILD = SOURCE / 'build'
TOOLS = ROOT / 'android-build-tools'
JAVA = TOOLS / 'jdk/amazon-corretto-17.jdk/Contents/Home/bin'
SDK = TOOLS / 'sdk/android-15'
PLATFORM = TOOLS / 'sdk/android-35/android.jar'
PRIVATE = ROOT / '.deploy'
OUTPUT = ROOT / 'releases/jianmoxi-0.1.3.apk'

def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT)

BUILD.mkdir(parents=True, exist_ok=True)
for name in ('classes','dex','generated'):
    if (BUILD / name).exists():shutil.rmtree(BUILD / name)
(BUILD / 'classes').mkdir(exist_ok=True)
(BUILD / 'dex').mkdir(exist_ok=True)
OUTPUT.parent.mkdir(exist_ok=True)
PRIVATE.mkdir(mode=0o700, exist_ok=True)
for name in ['aapt2', 'aapt', 'zipalign', 'dexdump']:
    (SDK / name).chmod(0o755)
run(SDK / 'aapt2', 'compile', '--dir', SOURCE / 'res', '-o', BUILD / 'resources.zip')
run(SDK / 'aapt2', 'link', '-I', PLATFORM, '--manifest', SOURCE / 'AndroidManifest.xml',
    '--java', BUILD / 'generated', '-o', BUILD / 'resources.apk', BUILD / 'resources.zip')
sources = list((SOURCE / 'src').rglob('*.java')) + list((BUILD / 'generated').rglob('*.java'))
run(JAVA / 'javac', '-encoding', 'UTF-8', '--release', '8', '-classpath', PLATFORM,
    '-d', BUILD / 'classes', *sources)
run(JAVA / 'java', '-cp', SDK / 'lib/d8.jar', 'com.android.tools.r8.D8', '--release',
    '--min-api', '26', '--lib', PLATFORM, '--output', BUILD / 'dex', *list((BUILD / 'classes').rglob('*.class')))
shutil.copyfile(BUILD / 'resources.apk', BUILD / 'unsigned.apk')
with zipfile.ZipFile(BUILD / 'unsigned.apk', 'a', zipfile.ZIP_DEFLATED) as package:
    for dex in (BUILD / 'dex').glob('*.dex'):
        package.write(dex, dex.name)
run(SDK / 'zipalign', '-f', '-p', '4', BUILD / 'unsigned.apk', BUILD / 'aligned.apk')
password = PRIVATE / 'android-signing.pass'
keystore = PRIVATE / 'android-signing.p12'
if not keystore.exists():
    if password.exists():
        raise RuntimeError('Signing password exists without keystore; review before regenerating')
    fd = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(secrets.token_urlsafe(32))
    run(JAVA / 'keytool', '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12',
        '-storepass:file', password, '-alias', 'xingzou', '-keyalg', 'RSA', '-keysize', '3072',
        '-validity', '10000', '-dname', 'CN=Xingzou Android,OU=Personal Test,O=Xingzou,C=CN')
    keystore.chmod(0o600)
run(JAVA / 'java', '-jar', SDK / 'lib/apksigner.jar', 'sign', '--ks', keystore,
    '--ks-key-alias', 'xingzou', '--ks-pass', 'file:' + str(password), '--v4-signing-enabled', 'false',
    '--out', OUTPUT, BUILD / 'aligned.apk')
run(JAVA / 'java', '-jar', SDK / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', OUTPUT)
run(SDK / 'zipalign', '-c', '-p', '4', OUTPUT)
checksum = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
OUTPUT.with_suffix('.apk.sha256').write_text(checksum + '  ' + OUTPUT.name + '\n')
print(f'Built {OUTPUT.name}: {OUTPUT.stat().st_size:,} bytes; SHA256 {checksum}')

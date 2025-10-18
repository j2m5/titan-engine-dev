:: Run this file as admin

cd /d "%~dp0"
if exist public\images (
    echo Symlink already exists
) else (
    mklink /D public\images ..\storage\images
    echo Done
)
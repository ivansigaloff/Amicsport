const FtpDeploy = require("ftp-deploy");
const ftpDeploy = new FtpDeploy();
const path = require("path");

const config = {
    user: "user-8594235",
    password: "X6#x8XqnLw#vwae5",
    host: "79.139.120.28",
    port: 21,
    localRoot: path.join(__dirname, "../dist"),
    remoteRoot: "/multigraf.info/Kickerzbcn/",
    // include: ["*", "**/*"],      // this would upload everything except dot files
    include: ["*", "**/*"],
    // exclude: [".git*", ".idea*", ".vscode*", "scripts/**"],
    deleteRemote: true,              // delete existing files in remoteRoot before uploading
    forcePasv: true,                 // Passive mode is usually required for FTP uploads
    sftp: false                      // set to true if using sftp
};

console.log("🚀 Starting deployment to FTP...");
console.log(`📡 Host: ${config.host}`);
console.log(`📂 Source: ${config.localRoot}`);
console.log(`🎯 Destination: ${config.remoteRoot}`);

ftpDeploy.on("uploading", function (data) {
    console.log(`📤 Uploading (${data.transferredFileCount}/${data.totalFilesCount}): ${data.filename}`);
});

ftpDeploy.on("uploaded", function (data) {
    console.log(`✅ Uploaded ${data.transferredFileCount}/${data.totalFilesCount}: ${data.filename}`);
});

ftpDeploy.on("log", function (data) {
    console.log(data);
});

ftpDeploy.on("upload-error", function (data) {
    console.error(`❌ Error uploading ${data.filename}:`, data.err);
});

ftpDeploy
    .deploy(config)
    .then((res) => {
        console.log("\n✨ Deployment finished successfully!");
        console.log("🔗 URL: http://multigraf.info/Kickerzbcn/");
    })
    .catch((err) => {
        console.error("\n💥 Deployment failed!");
        console.error(err);
    });

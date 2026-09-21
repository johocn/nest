// LayaAir IDE 命令行构建入口（--script=Build.buildWeb）
IEditorEnv.regClass();

export class Build {
  static async buildWeb(): Promise<void> {
    await IEditorEnv.BuildTask.start('web').waitForCompletion();
    console.log('[cli] build web done');
  }
}
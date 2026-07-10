import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private project: string;

  constructor() {   
    this.project = localStorage.getItem('project') || 'master';
  }
  setproject(projectname: string) {
    this.project = projectname;
    localStorage.setItem('project', projectname);
  }
  getproject(): string {
    return this.project;
  }
}

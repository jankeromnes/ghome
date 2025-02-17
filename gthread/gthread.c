/*************************************************************************
                           GTHREAD.C  -  description
                             -------------------
    début                : 31/01/2012
    copyright            : (C) 2012 par H4111
*************************************************************************/

/*------------------------------------------------------------------------
Les fonctions de ce fichier implemente un ordonnanceur
L'ordonnanceur est un Round Robin
------------------------------------------------------------------------*/

/*/////////////////////////////////////////////////////////////  INCLUDE*/
/*------------------------------------------------------ Include système*/
#include <stdio.h>
#include <stdlib.h>
/*---------------------------------------------------- Include personnel*/
#include "gthread.h"
#include "hw.h"

/*/////////////////////////////////////////////////////////  DECLARATION*/
/*----------------------------------------------------------- Constantes*/
/*Etat du processus*/
#define RUNNING 0
#define READY 1
#define ACTIVATED 2 /*stoped*/

/*---------------------------------------------------------------- Types*/
typedef struct
{
	int* esp;
	int* ebp;
	int state;
	func_t* function;
	void* args;
	void* pileExecution;
	void* next;
}ctx_s;

/*---------------------------------------------------------- Variables */
ctx_s* ctx_chainee=NULL;
ctx_s* ctx_courant=NULL;

/*---------------------------------------------------------- Fonctions */
void yield();
void start_current_context();

/*/////////////////////////////////////////////////////  IMPLEMENTATION*/
/*
 * Permet lancer l'ordonnanceur
 * Le changement de contexte se fera toutes les 8ms.
 */
void start_sched()
{
	setup_irq(TIMER_IRQ,yield);
	start_hw();
	yield();
}

/*
 * Permet de creer un contexte pour l'ordonnanceur
 * stack_size correspond à la taille de la pile d'execution (16384 est conseillé si vous ne savez pas quoi mettre)
 * f correspond à la fonction qui va être appellé par l'ordonnanceur
 * args correspond aux arguments à envoyé avec la fonction f
 */
int create_ctx(int stack_size,func_t f, void *args)
{
	irq_disable();
	ctx_s* ctx = malloc(sizeof(ctx_s));
	
	/*On place le contexte dans la chaine des contextes*/
	if(ctx_chainee!=NULL)
	{
		ctx->next = ctx_chainee->next;
		ctx_chainee->next=ctx;
	}
	else
	{
		ctx_chainee=ctx;
		ctx->next=ctx;
	}
	ctx->pileExecution = malloc(stack_size);
	ctx->esp = ctx->pileExecution+stack_size-1;
	ctx->ebp = ctx->pileExecution+stack_size-1;
	ctx->function=f;
	ctx->args = args;
	ctx->state = READY;
	irq_enable();
	return 0;
}

/*
 * Permet d'appeller la fonction du contexte pour la premiere fois
 */
void start_current_context()
{
	ctx_courant->state=RUNNING;
	irq_enable();
	ctx_courant->function(ctx_courant->args);
}

/*
 * Fonction appeller par l'ordonnanceur toutes les 8ms 
 * Pour comprendre comment cette fonction est appeller, il faut voir le fichier hw.c
 */
void yield()
{
	irq_disable();
	/*Si il y a un contexte courant, on le sauve pour pouvoir le relancer plus tard*/
	if(ctx_courant!=NULL)
	{
		ctx_courant->state=ACTIVATED;
		__asm__("movl %%esp, %1\n\t" 
			"movl %%ebp, %0"
			: "=r"(ctx_courant->ebp),"=r"(ctx_courant->esp)
			:  
			: "%esp","%ebp");
	}
	/*On passe au contexte suivant*/
	ctx_courant=ctx_chainee;
	ctx_chainee=ctx_chainee->next;
	
	/*On restaure le contexte*/
	__asm__("movl %1,%%esp\n\t" 
			"movl %0,%%ebp"
			: 
			: "r"(ctx_courant->ebp),"r"(ctx_courant->esp)  
			: "%esp","%ebp"); 
	
	/*Si le contexte est restauré pour la premiere  fois
	 *On appelle directement la fonction */
	if(ctx_courant->state == READY)
	{
		start_current_context();
	}
	ctx_courant->state = RUNNING;
	irq_enable();
	return;
}

